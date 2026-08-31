import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { HOOK_SCRIPTS } from "./scripts";

let workDir: string;
let runtimeDir: string;
let stubBin: string;

/**
 * Stub `bertrand` binary: the `contract` subcommand echoes a marker string so
 * the injection tests can assert which variant was requested; every other
 * subcommand (update/ingest-transcript) is a silent no-op so it can't
 * pollute a hook's stdout.
 */
const stubScript = (runtimeDir: string) => `#!/usr/bin/env bash
# When BERTRAND_STUB_LOG points somewhere, record the call so the guard tests
# can assert which session the hook resolved and which project it targeted.
# Unset for every other test, so the stub stays silent for them.
if [ -n "\${BERTRAND_STUB_LOG:-}" ]; then
  printf 'argv=%s project=%s\\n' "$*" "\${BERTRAND_PROJECT:-<unset>}" >> "$BERTRAND_STUB_LOG"
fi
if [ "$1" = "contract" ]; then
  case "$*" in
    *--short*) printf 'SHORT_CONTRACT' ;;
    *) printf 'FULL_CONTRACT' ;;
  esac
fi
# Stands in for the real \`auto-adopt\`, whose only observable effect on the
# hook is which marker it leaves behind. BERTRAND_STUB_AUTO picks the outcome;
# unset means the transient-failure case, where it writes nothing at all.
if [ "$1" = "auto-adopt" ]; then
  case "\${BERTRAND_STUB_AUTO:-}" in
    create)
      printf 'session=auto-sid\\nproject=auto-project\\n' \\
        > "${runtimeDir}/adopted-$CLAUDE_CODE_SESSION_ID" ;;
    decline)
      printf 'declined=not-opted-in\\n' \\
        > "${runtimeDir}/autocreate-$CLAUDE_CODE_SESSION_ID" ;;
  esac
fi
`;

function render(name: keyof typeof HOOK_SCRIPTS): string {
  const path = join(workDir, name);
  writeFileSync(path, HOOK_SCRIPTS[name](stubBin, runtimeDir));
  chmodSync(path, 0o755);
  return path;
}

function run(
  name: keyof typeof HOOK_SCRIPTS,
  input: string,
  env: Record<string, string> = {},
): { stdout: string; code: number } {
  const path = render(name);
  // Clean env (no spread of process.env) so the parent's BERTRAND_* vars can't
  // leak into the guard tests. PATH is needed for jq/grep/cat/printf.
  const proc = Bun.spawnSync(["bash", path], {
    stdin: Buffer.from(input),
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  return {
    stdout: proc.stdout.toString().trim(),
    code: proc.exitCode ?? 0,
  };
}

const marker = (n: string) => join(runtimeDir, n);

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "bertrand-scripts-"));
  runtimeDir = join(workDir, "run");
  mkdirSync(runtimeDir, { recursive: true });
  stubBin = join(workDir, "stub-bertrand");
  writeFileSync(stubBin, stubScript(runtimeDir));
  chmodSync(stubBin, 0o755);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const SID = "sid1";
const CID = "cid1";
const STOP_INPUT = JSON.stringify({ transcript_path: "" });

describe("on-done.sh — AUQ loop enforcement", () => {
  test("turn without AUQ → blocks and increments the nudge counter", () => {
    const { stdout } = run("on-done.sh", STOP_INPUT, { BERTRAND_SESSION: SID });
    const decision = JSON.parse(stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("AskUserQuestion");
    expect(readFileSync(marker(`auq-nudge-${SID}`), "utf8")).toBe("1");
  });

  test("blocks up to the cap, then pauses and clears the counter", () => {
    const env = { BERTRAND_SESSION: SID };
    for (const expected of ["1", "2", "3"]) {
      const { stdout } = run("on-done.sh", STOP_INPUT, env);
      expect(JSON.parse(stdout).decision).toBe("block");
      expect(readFileSync(marker(`auq-nudge-${SID}`), "utf8")).toBe(expected);
    }
    // 4th stop: counter is at the cap → no block, marker cleared.
    const { stdout } = run("on-done.sh", STOP_INPUT, env);
    expect(stdout).toBe("");
    expect(existsSync(marker(`auq-nudge-${SID}`))).toBe(false);
  });

  test("Done-for-now exit (done marker present) → no block, markers cleared", () => {
    writeFileSync(marker(`done-${SID}`), "");
    writeFileSync(marker(`auq-nudge-${SID}`), "2");
    const { stdout } = run("on-done.sh", STOP_INPUT, { BERTRAND_SESSION: SID });
    expect(stdout).toBe("");
    expect(existsSync(marker(`done-${SID}`))).toBe(false);
    expect(existsSync(marker(`auq-nudge-${SID}`))).toBe(false);
  });

  test("outside a bertrand session (no BERTRAND_SESSION) → no-op", () => {
    const { stdout, code } = run("on-done.sh", STOP_INPUT);
    expect(stdout).toBe("");
    expect(code).toBe(0);
  });
});

describe("on-answered.sh — Done-for-now handoff", () => {
  test("Done-for-now answer → drops done marker, clears nudge, halts the loop", () => {
    writeFileSync(marker(`auq-nudge-${SID}`), "2");
    const input = JSON.stringify({
      tool_input: { answers: { q: "Done for now" }, questions: [] },
    });
    const { stdout } = run("on-answered.sh", input, {
      BERTRAND_SESSION: SID,
      BERTRAND_CLAUDE_ID: CID,
    });
    expect(stdout).toContain('"continue": false');
    expect(existsSync(marker(`done-${SID}`))).toBe(true);
    expect(existsSync(marker(`auq-nudge-${SID}`))).toBe(false);
  });

  test("ordinary answer → no done marker, nudge counter reset", () => {
    writeFileSync(marker(`auq-nudge-${SID}`), "1");
    const input = JSON.stringify({
      tool_input: { answers: { q: "Keep going" }, questions: [] },
    });
    const { stdout } = run("on-answered.sh", input, {
      BERTRAND_SESSION: SID,
      BERTRAND_CLAUDE_ID: CID,
    });
    expect(stdout).not.toContain('"continue": false');
    expect(existsSync(marker(`done-${SID}`))).toBe(false);
    expect(existsSync(marker(`auq-nudge-${SID}`))).toBe(false);
  });
});

describe("on-user-prompt.sh — contract re-injection", () => {
  const PROMPT_INPUT = JSON.stringify({ prompt: "hello" });
  const env = { BERTRAND_SESSION: SID, BERTRAND_CLAUDE_ID: CID };

  test("first prompt injects the full contract and records the marker", () => {
    const { stdout } = run("on-user-prompt.sh", PROMPT_INPUT, env);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toBe("FULL_CONTRACT");
    expect(existsSync(marker(`contract-sent-${CID}`))).toBe(true);
  });

  test("subsequent prompt injects the short reminder", () => {
    writeFileSync(marker(`contract-sent-${CID}`), "");
    const { stdout } = run("on-user-prompt.sh", PROMPT_INPUT, env);
    expect(JSON.parse(stdout).hookSpecificOutput.additionalContext).toBe(
      "SHORT_CONTRACT",
    );
  });
});

describe("transcript ingestion ticks", () => {
  // The rendered scripts must carry the transcript path into the bertrand
  // invocations that tick ingestion — content checks, since the stub binary
  // can't observe its own argv here.
  const rendered = (name: keyof typeof HOOK_SCRIPTS) =>
    HOOK_SCRIPTS[name]("BIN", "RUNTIME");

  test("on-waiting.sh flushes via the session.waiting update", () => {
    const script = rendered("on-waiting.sh");
    expect(script).toContain('--transcript-path "$tpath" --flush');
    expect(script).not.toContain("assistant-message");
  });

  test("on-permission-done.sh ticks ingestion on both tool event paths", () => {
    const script = rendered("on-permission-done.sh");
    const ticks = script.match(/--transcript-path "\$tpath"/g) ?? [];
    expect(ticks.length).toBe(2); // tool.applied + tool.used
  });

  test("on-done.sh flushes via the standalone ingest command", () => {
    const script = rendered("on-done.sh");
    expect(script).toContain("ingest-transcript");
    expect(script).toContain("--flush");
    expect(script).not.toContain("assistant-message");
  });
});

describe("session guard — adoption marker fallback", () => {
  // A claude bertrand launched exports BERTRAND_SESSION; one that was adopted
  // cannot be given env at all, so the guard keys off CLAUDE_CODE_SESSION_ID
  // (which claude exports into every hook subprocess) and the marker written
  // by `bertrand adopt`.
  const CLAUDE_SID = "11111111-2222-4333-8444-555555555555";
  const TOOL_INPUT = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: "ls" },
    transcript_path: "",
  });

  let stubLog: string;

  beforeEach(() => {
    stubLog = join(workDir, "stub.log");
  });

  const calls = (): string =>
    existsSync(stubLog) ? readFileSync(stubLog, "utf-8") : "";

  function adopt(sessionId: string, project: string, claudeId = CLAUDE_SID) {
    writeFileSync(
      marker(`adopted-${claudeId}`),
      `session=${sessionId}\nproject=${project}\n`,
    );
  }

  test("no marker → total no-op, and the binary is never invoked", () => {
    const { stdout, code } = run("on-permission-done.sh", TOOL_INPUT, {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(stdout).toBe("");
    // This is the path every unadopted claude on the machine takes, so it has
    // to cost nothing — not even a process spawn.
    expect(calls()).toBe("");
  });

  test("marker present → resolves the session and its project", () => {
    adopt("adopted-sid", "some-project");

    const { code } = run("on-permission-done.sh", TOOL_INPUT, {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toContain("--session-id adopted-sid");
    // Without the project the bin would write into whichever project happens
    // to be active in the registry when the hook fires.
    expect(calls()).toContain("project=some-project");
  });

  test("marker present → conversation id is claude's own session id", () => {
    adopt("adopted-sid", "some-project");

    run("on-permission-done.sh", TOOL_INPUT, {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    // `bertrand adopt` keyed the conversation row on claude's session id, so
    // events have to carry that same value as claude_id.
    expect(calls()).toContain(CLAUDE_SID);
  });

  test("env wins over the marker, and never leaks the marker's project", () => {
    adopt("adopted-sid", "marker-project");

    run("on-permission-done.sh", TOOL_INPUT, {
      BERTRAND_SESSION: "env-sid",
      BERTRAND_CLAUDE_ID: "env-cid",
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(calls()).toContain("--session-id env-sid");
    expect(calls()).not.toContain("adopted-sid");
    expect(calls()).toContain("project=<unset>");
  });

  test("no CLAUDE_CODE_SESSION_ID → no-op, even with markers around", () => {
    adopt("adopted-sid", "some-project");

    const { code } = run("on-permission-done.sh", TOOL_INPUT, {
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toBe("");
  });

  test("marker missing its session field → no-op, not a half-resolved session", () => {
    // A partial write must not resolve: a session id without its project would
    // land the events in the wrong DB.
    writeFileSync(marker(`adopted-${CLAUDE_SID}`), "project=orphan\n");

    const { code } = run("on-permission-done.sh", TOOL_INPUT, {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toBe("");
  });

  test("every hook carries the fallback, not just the one under test", () => {
    // The guard is shared, so this is what keeps a future hook from being
    // added with the old two-line BERTRAND_SESSION-only check.
    for (const name of Object.keys(HOOK_SCRIPTS) as (keyof typeof HOOK_SCRIPTS)[]) {
      const script = HOOK_SCRIPTS[name]("BIN", "RUNTIME");
      expect(script).toContain('ccid="${CLAUDE_CODE_SESSION_ID:-}"');
      expect(script).toContain('adopted="RUNTIME/adopted-$ccid"');
      expect(script).toContain("export BERTRAND_PROJECT");
    }
  });

  test("the no-op path spawns nothing and parses no payload", () => {
    // Hooks are hot-path: every claude on the machine fires them. The guard
    // must stay bash builtins only — no jq, no grep, no subshell — before it
    // knows the session is ours.
    const guard = HOOK_SCRIPTS["on-done.sh"]("BIN", "RUNTIME")
      .split("\nfi\n")[0]!;
    expect(guard).not.toContain("jq");
    expect(guard).not.toContain("grep");
    expect(guard).not.toContain("$(cat)");
    expect(guard).not.toContain("session_id\":");
  });
});

describe("session guard — auto-create (ELKY-175)", () => {
  // Automatic adoption of an unseen claude session id. Unlike the marker
  // fallback above, this rung may *create*, so the tests here are mostly about
  // what stops it: one prompt is not enough, and a refusal must stick.
  const CLAUDE_SID = "99999999-8888-4777-8666-555555555555";
  const PROMPT = JSON.stringify({
    prompt: "do the thing",
    cwd: "/work/repo",
    transcript_path: "/transcripts/x.jsonl",
    session_id: CLAUDE_SID,
  });

  let stubLog: string;

  beforeEach(() => {
    stubLog = join(workDir, "stub.log");
  });

  const calls = (): string =>
    existsSync(stubLog) ? readFileSync(stubLog, "utf-8") : "";

  /** Env of a claude bertrand neither launched nor was pointed at. */
  const untracked = (auto?: "create" | "decline") => ({
    CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
    BERTRAND_STUB_LOG: stubLog,
    ...(auto ? { BERTRAND_STUB_AUTO: auto } : {}),
  });

  const gate = () => marker(`autocreate-${CLAUDE_SID}`);

  test("first prompt arms the gate and spawns nothing", () => {
    const { code, stdout } = run("on-user-prompt.sh", PROMPT, untracked("create"));

    expect(code).toBe(0);
    expect(stdout).toBe("");
    // One prompt is not yet work worth recording — that is the materiality
    // gate, and it must cost nothing but a file test and a truncate.
    expect(calls()).toBe("");
    expect(existsSync(gate())).toBe(true);
    expect(readFileSync(gate(), "utf-8")).toBe("");
  });

  test("second prompt asks auto-adopt, passing the payload's cwd and transcript", () => {
    writeFileSync(gate(), "");

    run("on-user-prompt.sh", PROMPT, untracked("create"));

    expect(calls()).toContain("auto-adopt");
    expect(calls()).toContain(`--claude-id ${CLAUDE_SID}`);
    // From the payload, not $PWD: picking the wrong project files the session
    // in another project's log with nothing to say so.
    expect(calls()).toContain("--cwd /work/repo");
    expect(calls()).toContain("--transcript-path /transcripts/x.jsonl");
  });

  test("a created session records this very prompt and gets the contract", () => {
    writeFileSync(gate(), "");

    const { stdout } = run("on-user-prompt.sh", PROMPT, untracked("create"));

    // The marker the stub wrote is re-read by the same guard invocation, so
    // the prompt that triggered creation is not lost.
    expect(calls()).toContain("--session-id auto-sid --event user.prompt");
    expect(calls()).toContain("project=auto-project");
    expect(stdout).toContain("FULL_CONTRACT");
  });

  test("a remembered decline short-circuits before anything is spawned", () => {
    writeFileSync(gate(), "declined=not-opted-in\n");

    const { code, stdout } = run("on-user-prompt.sh", PROMPT, untracked("create"));

    expect(code).toBe(0);
    expect(stdout).toBe("");
    // Every prompt in every unregistered directory on the machine takes this
    // path; it has to stay a file test.
    expect(calls()).toBe("");
  });

  test("auto-adopt declining writes the reason, so the next prompt is free", () => {
    writeFileSync(gate(), "");

    run("on-user-prompt.sh", PROMPT, untracked("decline"));
    expect(calls()).toContain("auto-adopt");
    expect(readFileSync(gate(), "utf-8")).toContain("declined=");

    // Second run: the gate is non-empty now, so nothing is spawned at all.
    writeFileSync(stubLog, "");
    run("on-user-prompt.sh", PROMPT, untracked("decline"));
    expect(calls()).toBe("");
  });

  test("a transient failure leaves the gate armed so the next prompt retries", () => {
    writeFileSync(gate(), "");

    // No BERTRAND_STUB_AUTO: the stub writes neither marker, standing in for a
    // locked DB or a git that didn't answer.
    const { code, stdout } = run("on-user-prompt.sh", PROMPT, untracked());

    expect(code).toBe(0);
    expect(stdout).toBe("");
    expect(calls()).toContain("auto-adopt");
    // Empty, not declined: a failure we might recover from must not be
    // remembered as a refusal.
    expect(readFileSync(gate(), "utf-8")).toBe("");
  });

  test("an already-adopted conversation skips the gate entirely", () => {
    writeFileSync(
      marker(`adopted-${CLAUDE_SID}`),
      "session=adopted-sid\nproject=some-project\n",
    );

    run("on-user-prompt.sh", PROMPT, untracked("create"));

    expect(calls()).toContain("--session-id adopted-sid");
    expect(calls()).not.toContain("auto-adopt");
    expect(existsSync(gate())).toBe(false);
  });

  test("a launched session never touches the gate", () => {
    run("on-user-prompt.sh", PROMPT, {
      ...untracked("create"),
      BERTRAND_SESSION: "env-sid",
      BERTRAND_CLAUDE_ID: "env-cid",
    });

    expect(calls()).toContain("--session-id env-sid");
    expect(calls()).not.toContain("auto-adopt");
    // No duplicate row for a claude bertrand already owns, and no marker
    // pointing the hooks somewhere else.
    expect(existsSync(gate())).toBe(false);
    expect(existsSync(marker(`adopted-${CLAUDE_SID}`))).toBe(false);
  });

  test("only the user-prompt hook may create; the other five still no-op", () => {
    for (const name of Object.keys(HOOK_SCRIPTS) as (keyof typeof HOOK_SCRIPTS)[]) {
      const script = HOOK_SCRIPTS[name]("BIN", "RUNTIME");
      const hasGate = script.includes("autocreate-$ccid");
      // The four hot hooks fire dozens of times a turn for every claude on the
      // machine, and Stop fires on every one of them too. Creation belongs on
      // the one event a subagent cannot produce.
      expect(hasGate).toBe(name === "on-user-prompt.sh");
    }
  });
});
