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
const STUB = `#!/usr/bin/env bash
if [ "$1" = "contract" ]; then
  case "$*" in
    *--short*) printf 'SHORT_CONTRACT' ;;
    *) printf 'FULL_CONTRACT' ;;
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
  writeFileSync(stubBin, STUB);
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

describe("on-enter-worktree.sh — worktree tracking", () => {
  test("writes a worktree marker holding the entered cwd", () => {
    // workDir isn't a git repo, so branch resolution fails silently — the
    // marker is still written from the payload's cwd, which is what we assert.
    const input = JSON.stringify({ cwd: workDir });
    run("on-enter-worktree.sh", input, {
      BERTRAND_SESSION: SID,
      BERTRAND_CLAUDE_ID: CID,
    });
    expect(existsSync(marker(`worktree-${SID}`))).toBe(true);
    expect(readFileSync(marker(`worktree-${SID}`), "utf8")).toBe(workDir);
  });

  test("outside a bertrand session (no BERTRAND_SESSION) → no marker", () => {
    run("on-enter-worktree.sh", JSON.stringify({ cwd: workDir }));
    expect(existsSync(marker(`worktree-${SID}`))).toBe(false);
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

describe("on-exit-worktree.sh — worktree teardown", () => {
  test("removes the worktree marker on exit", () => {
    writeFileSync(marker(`worktree-${SID}`), workDir);
    run("on-exit-worktree.sh", "{}", {
      BERTRAND_SESSION: SID,
      BERTRAND_CLAUDE_ID: CID,
    });
    expect(existsSync(marker(`worktree-${SID}`))).toBe(false);
  });
});
