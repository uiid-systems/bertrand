#!/usr/bin/env bun
/**
 * Tier 3 paired replay (docs/context-budget.md, "Tier 3 replay plan"): re-run
 * past tasks headless with and without the Tier 2 history, and compare what
 * each arm cost.
 *
 *   bun scripts/replay/replay.ts run --tasks tasks.json --out runs.jsonl
 *       [--repeats 2] [--model <id>] [--only <id,id>] [--dry-run] [--keep]
 *   bun scripts/replay/replay.ts report --out runs.jsonl
 *
 * Spends real tokens: the pilot (3 tasks x 2 arms x 2 repeats) is ~15M
 * processed. `--dry-run` does everything but call claude. Run it where the
 * tasks' repos and transcripts live (the work machine). Task format: see
 * tasks.example.json.
 */
import { randomUUID } from "crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join, resolve } from "path";
import { claudeTranscriptPath, summarizeTranscript } from "@/lib/transcript";
import { cutSnapshot, writeBertrandShim } from "./snapshot";
import { isCorrect, verdict, type RunRecord } from "./report";

interface Task {
  id: string;
  /** bertrand session the task was asked in. */
  session: string;
  /** The replayed conversation (id or 8-char prefix), kept out of its own digest. */
  conversation?: string;
  /** When the task was originally asked. ISO or sqlite time. */
  asOf: string;
  /** A local checkout of the task's repo. */
  repo: string;
  /** Pinned commit; default: the last commit on `branch` before `asOf`. */
  commit?: string;
  branch?: string;
  /** Self-contained: headless runs have no AskUserQuestion loop. */
  prompt: string;
  /** Facts a correct answer contains, matched case-insensitively. */
  answerKey: string[];
}

const ARMS = ["control", "treatment"] as const;
/** Read-only: a replay answers a question, it never edits the checkout. */
const TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git diff:*)",
  "Bash(bertrand log:*)",
  "Bash(bertrand search:*)",
  "Bash(bertrand list:*)",
];
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
/** This checkout's bertrand: `replay-context` isn't in a released build yet. */
const BERTRAND = ["bun", resolve(import.meta.dir, "../../src/index.ts")];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {}) {
  const proc = Bun.spawnSync(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin === undefined ? "ignore" : Buffer.from(opts.stdin),
  });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${proc.stderr.toString().trim()}`);
  }
  return proc.stdout.toString();
}

/** process.env minus bertrand's identity, so no replay records into a session. */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("BERTRAND_") && k !== "CLAUDE_CODE_SESSION_ID") env[k] = v;
  }
  return { ...env, ...extra };
}

async function run(): Promise<void> {
  const tasksPath = flag("tasks") ?? fail("--tasks <file> is required");
  const out = flag("out") ?? fail("--out <file> is required");
  const repeats = Number(flag("repeats") ?? 2);
  const only = flag("only")?.split(",");
  const dry = args.includes("--dry-run");
  const model = flag("model");

  const tasks = (JSON.parse(readFileSync(tasksPath, "utf-8")) as Task[]).filter(
    (t) => !only || only.includes(t.id),
  );
  for (const t of tasks) {
    // An empty key would grade every answer correct.
    if (!t.answerKey?.length) fail(`${t.id}: answerKey must list at least one fact`);
  }
  const source = join(homedir(), ".bertrand", "bertrand.db");

  for (const task of tasks) {
    const work = mkdtempSync(join(tmpdir(), `bertrand-replay-${task.id}-`));
    const home = join(work, "home");
    const bin = join(work, "bin");
    const tree = join(work, "tree");
    try {
      cutSnapshot(source, home, task.asOf);
      writeBertrandShim(bin, home, BERTRAND);
      const commit =
        task.commit ??
        sh(["git", "-C", task.repo, "rev-list", "-1", `--before=${task.asOf}`, task.branch ?? "main"]).trim();
      if (!commit) throw new Error(`no commit on ${task.branch ?? "main"} before ${task.asOf}`);
      sh(["git", "-C", task.repo, "worktree", "add", "--detach", tree, commit]);

      const system = Object.fromEntries(
        ARMS.map((arm) => [
          arm,
          sh(
            [
              ...BERTRAND,
              "replay-context",
              "--session", task.session,
              "--as-of", task.asOf,
              "--arm", arm,
              ...(task.conversation ? ["--conversation", task.conversation] : []),
            ],
            { env: cleanEnv({ HOME: home }), stdin: task.prompt },
          ),
        ]),
      ) as Record<(typeof ARMS)[number], string>;
      console.error(
        `${task.id} @ ${commit.slice(0, 8)}: control ${system.control.length}B, treatment ${system.treatment.length}B`,
      );

      for (let rep = 1; rep <= repeats; rep++) {
        // Interleaved in random order, so neither arm always runs second
        // against a cache the other one warmed.
        const order = Math.random() < 0.5 ? [...ARMS] : [...ARMS].reverse();
        for (const arm of order) {
          const record = dry
            ? null
            : runArm(task, arm, rep, system[arm], { tree, bin, model });
          if (record) appendFileSync(out, JSON.stringify(record) + "\n");
          console.error(
            dry
              ? `  [dry] ${arm} rep ${rep}`
              : `  ${arm} rep ${rep}: ${record!.error ?? `${(record!.processed / 1e6).toFixed(2)}M, ${record!.requests} req, ${record!.correct ? "correct" : "wrong"}`}`,
          );
        }
      }
    } catch (e) {
      console.error(`${task.id}: ${e instanceof Error ? e.message : e}`);
    } finally {
      if (existsSync(tree)) {
        try {
          sh(["git", "-C", task.repo, "worktree", "remove", "--force", tree]);
        } catch {
          // Left for `git worktree prune`.
        }
      }
      if (!args.includes("--keep")) rmSync(work, { recursive: true, force: true });
    }
  }
}

function runArm(
  task: Task,
  arm: (typeof ARMS)[number],
  rep: number,
  system: string,
  where: { tree: string; bin: string; model?: string },
): RunRecord & Record<string, unknown> {
  const sessionId = randomUUID();
  const base = { task: task.id, arm, rep, sessionId, systemBytes: Buffer.byteLength(system) };
  const proc = Bun.spawnSync(
    [
      "claude", "-p", task.prompt,
      "--output-format", "json",
      "--session-id", sessionId,
      "--append-system-prompt", system,
      "--settings", JSON.stringify({ disableAllHooks: true }),
      "--strict-mcp-config",
      "--allowedTools", ...TOOLS,
      ...(where.model ? ["--model", where.model] : []),
    ],
    {
      cwd: where.tree,
      env: cleanEnv({ PATH: `${where.bin}:${process.env.PATH ?? ""}` }),
      stdin: "ignore",
      timeout: RUN_TIMEOUT_MS,
    },
  );

  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(proc.stdout.toString());
  } catch {
    // Reported below as an error.
  }
  const answer = typeof result.result === "string" ? result.result : "";
  // Counted from the transcript, as the plan's budget was: once per message
  // id, sidechains included, so both arms are measured the same way.
  // Claude names the transcript's directory after its cwd; on macOS a temp
  // path may come back through /private, so try both spellings.
  const transcript = [where.tree, realpathSync(where.tree)]
    .map((cwd) => claudeTranscriptPath(sessionId, cwd))
    .find((p) => existsSync(p));
  const usage = transcript ? summarizeTranscript(transcript) : null;
  const error =
    proc.exitCode !== 0 || result.is_error === true || !usage
      ? `exit ${proc.exitCode}: ${proc.stderr.toString().trim().slice(0, 300) || answer.slice(0, 300)}`
      : undefined;

  return {
    ...base,
    processed: usage
      ? usage.totalInputTokens + usage.totalCacheCreationTokens + usage.totalCacheReadTokens
      : 0,
    cacheRead: usage?.totalCacheReadTokens ?? 0,
    output: usage?.totalOutputTokens ?? 0,
    requests: usage?.turnCount ?? 0,
    model: usage?.model ?? null,
    durationMs: result.duration_ms ?? null,
    answer,
    correct: isCorrect(answer, task.answerKey),
    ...(error ? { error } : {}),
  };
}

function report(): void {
  const out = flag("out") ?? fail("--out <file> is required");
  const runs = readFileSync(out, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunRecord);
  const v = verdict(runs);
  if (!v) fail("No task has runs in both arms.");
  const pct = (x: number) => `${((x - 1) * 100).toFixed(1)}%`;
  for (const t of v!.tasks) {
    console.log(
      `${t.task}\t${pct(t.ratio)}\tcorrect ${t.control.correct}/${t.control.runs} → ${t.treatment.correct}/${t.treatment.runs}`,
    );
  }
  console.log(
    `\nmedian ${pct(v!.medianRatio)} processed tokens (95% CI ${pct(v!.ci[0])} … ${pct(v!.ci[1])}) over ${v!.tasks.length} tasks`,
  );
  console.log(
    `correct: control ${(v!.correct.control * 100).toFixed(0)}%, treatment ${(v!.correct.treatment * 100).toFixed(0)}%`,
  );
  console.log(v!.ship ? "verdict: ship Tier 2" : "verdict: don't ship Tier 2 (yet)");
  const errors = runs.filter((r) => r.error).length;
  if (errors) console.log(`(${errors} errored runs excluded)`);
}

const mode = args[0];
if (mode === "run") await run();
else if (mode === "report") report();
else fail("usage: replay.ts run|report …  (see the header of scripts/replay/replay.ts)");
