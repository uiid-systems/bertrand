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

describe("session guard — payload identity", () => {
  // A claude bertrand launched exports BERTRAND_SESSION; one that was adopted
  // cannot be given env at all, so the guard reads claude's session id out of
  // the hook payload and looks up the marker `bertrand adopt` left for it.
  // CLAUDE_CODE_SESSION_ID is kept only as a fallback for a payload the guard
  // can't parse.
  const CLAUDE_SID = "11111111-2222-4333-8444-555555555555";
  const PAYLOAD_SID = "99999999-8888-4777-8666-555555555555";

  /**
   * A PostToolUse payload with the field order Claude Code actually emits —
   * session_id first, tool_input last. JSON.stringify preserves insertion
   * order, so these fixtures reproduce the shape the guard's bounded read
   * depends on.
   */
  const payload = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({
      session_id: PAYLOAD_SID,
      transcript_path: "",
      ...fields,
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

  /** The pre-payload fixture: no session_id at all, so the env fallback runs. */
  const NO_SID_INPUT = JSON.stringify({
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

  function adopt(sessionId: string, project: string, claudeId = PAYLOAD_SID) {
    writeFileSync(
      marker(`adopted-${claudeId}`),
      `session=${sessionId}\nproject=${project}\n`,
    );
  }

  test("payload session_id resolves the session, with no env at all", () => {
    adopt("adopted-sid", "some-project");

    const { code } = run("on-permission-done.sh", payload(), {
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toContain("--session-id adopted-sid");
    // Without the project the bin would write into whichever project happens
    // to be active in the registry when the hook fires.
    expect(calls()).toContain("project=some-project");
    // `bertrand adopt` keyed the conversation row on claude's session id, so
    // events have to carry that same value as claude_id.
    expect(calls()).toContain(PAYLOAD_SID);
  });

  test("no marker → total no-op, and the binary is never invoked", () => {
    const { stdout, code } = run("on-permission-done.sh", payload(), {
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(stdout).toBe("");
    // This is the path every unadopted claude on the machine takes, so it has
    // to cost nothing — not even a process spawn.
    expect(calls()).toBe("");
  });

  test("payload wins over CLAUDE_CODE_SESSION_ID", () => {
    // Both resolve to a real marker, so only precedence decides the outcome.
    adopt("payload-sid", "payload-project", PAYLOAD_SID);
    adopt("env-sid", "env-project", CLAUDE_SID);

    run("on-permission-done.sh", payload(), {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(calls()).toContain("--session-id payload-sid");
    expect(calls()).not.toContain("env-sid");
  });

  test("unparseable payload → falls back to CLAUDE_CODE_SESSION_ID", () => {
    // The env var is undocumented, so it can't be the source of identity — but
    // dropping it would turn a payload shape we don't recognise into silence.
    adopt("adopted-sid", "some-project", CLAUDE_SID);

    run("on-permission-done.sh", NO_SID_INPUT, {
      CLAUDE_CODE_SESSION_ID: CLAUDE_SID,
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(calls()).toContain("--session-id adopted-sid");
  });

  test("whitespace after the colon parses the same as compact JSON", () => {
    // Claude emits compact JSON today, so this is insurance rather than a
    // requirement — but the alternative to parsing it is silently reverting to
    // env-var identity, which is the fragility this issue removes.
    adopt("adopted-sid", "some-project");

    const spaced = `{"session_id": "${PAYLOAD_SID}", "tool_name": "Bash"}`;
    run("on-permission-done.sh", spaced, { BERTRAND_STUB_LOG: stubLog });

    expect(calls()).toContain("--session-id adopted-sid");
  });

  test("a session_id with a path separator never builds a marker path", () => {
    adopt("adopted-sid", "some-project", CLAUDE_SID);

    run(
      "on-permission-done.sh",
      JSON.stringify({ session_id: "../../etc/passwd", tool_name: "Bash" }),
      { CLAUDE_CODE_SESSION_ID: CLAUDE_SID, BERTRAND_STUB_LOG: stubLog },
    );

    // Rejected outright and resolved through the env fallback instead.
    expect(calls()).toContain("--session-id adopted-sid");
  });

  test("an escaped session_id inside tool_input can't hijack identity", () => {
    // The greedy-match caveat ELKY-173 left open. Payload strings arrive
    // escaped (\"session_id\":\"…), so a tool argument carrying the literal
    // text — as this repo's own hook tests do — never matches the pattern.
    adopt("real-sid", "real-project", PAYLOAD_SID);
    adopt("decoy-sid", "decoy-project", CLAUDE_SID);

    const input = JSON.stringify({
      session_id: PAYLOAD_SID,
      transcript_path: "",
      tool_name: "Bash",
      tool_input: { command: `echo '{"session_id":"${CLAUDE_SID}"}'` },
    });

    run("on-permission-done.sh", input, { BERTRAND_STUB_LOG: stubLog });

    expect(calls()).toContain("--session-id real-sid");
    expect(calls()).not.toContain("decoy-sid");
  });

  test("payload past the 512-byte read window is still parsed downstream", () => {
    // The guard consumes a fixed head off stdin; every script rebuilds the
    // whole payload as "$phead$(cat)". Get that wrong and fields beyond the
    // window silently vanish — here, the transcript path that ticks ingestion.
    adopt("adopted-sid", "some-project");

    const input = JSON.stringify({
      session_id: PAYLOAD_SID,
      pad: "p".repeat(700),
      transcript_path: "/tmp/late-transcript.jsonl",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });
    expect(input.indexOf("transcript_path")).toBeGreaterThan(512);

    run("on-permission-done.sh", input, { BERTRAND_STUB_LOG: stubLog });

    expect(calls()).toContain("--transcript-path /tmp/late-transcript.jsonl");
  });

  test("env wins over the payload, and never leaks the marker's project", () => {
    adopt("adopted-sid", "marker-project");

    run("on-permission-done.sh", payload(), {
      BERTRAND_SESSION: "env-sid",
      BERTRAND_CLAUDE_ID: "env-cid",
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(calls()).toContain("--session-id env-sid");
    expect(calls()).not.toContain("adopted-sid");
    expect(calls()).toContain("project=<unset>");
  });

  test("no session id anywhere → no-op, even with markers around", () => {
    adopt("adopted-sid", "some-project");

    const { code } = run("on-permission-done.sh", NO_SID_INPUT, {
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toBe("");
  });

  test("marker missing its session field → no-op, not a half-resolved session", () => {
    // A partial write must not resolve: a session id without its project would
    // land the events in the wrong DB.
    writeFileSync(marker(`adopted-${PAYLOAD_SID}`), "project=orphan\n");

    const { code } = run("on-permission-done.sh", payload(), {
      BERTRAND_STUB_LOG: stubLog,
    });

    expect(code).toBe(0);
    expect(calls()).toBe("");
  });

  test("every hook resolves identity the same way, not just the one under test", () => {
    // The guard is shared, so this is what keeps a future hook from being
    // added with the old env-only check — or from reading stdin with a bare
    // $(cat), which would drop the 512 bytes the guard already consumed.
    for (const name of Object.keys(HOOK_SCRIPTS) as (keyof typeof HOOK_SCRIPTS)[]) {
      const script = HOOK_SCRIPTS[name]("BIN", "RUNTIME");
      expect(script).toContain(`IFS= read -r -d '' -n 512 phead`);
      expect(script).toContain(`ccid="\${phead#*\\"session_id\\":}"`);
      expect(script).toContain('ccid="${CLAUDE_CODE_SESSION_ID:-}"');
      expect(script).toContain('adopted="RUNTIME/adopted-$ccid"');
      expect(script).toContain("export BERTRAND_PROJECT");
      expect(script).not.toContain('input="$(cat)"');
    }
  });

  test("the no-op path forks nothing", () => {
    // Hooks are hot-path: every claude on the machine fires them, and almost
    // none are ours. The guard must stay bash builtins only — no jq, no grep,
    // no command substitution — before it knows the session is ours. A bounded
    // `read` is what buys payload identity at zero fork cost.
    const guard = HOOK_SCRIPTS["on-done.sh"]("BIN", "RUNTIME").split("\nfi\n")[0]!;
    expect(guard).toContain("read -r -d '' -n 512 phead");
    for (const fork of ["jq", "grep", "cut", "$(", "`"]) {
      expect(guard).not.toContain(fork);
    }
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

  test("auto-adopt still sees cwd when the guard consumed the payload head", () => {
    // The seam between ELKY-174 and ELKY-175. The guard reads a fixed 512-byte
    // head off stdin; the auto-create rung then reads the rest and greps it for
    // cwd and transcript_path — both of which live in that head, in Claude's
    // real field order. Read the tail alone and auto-adopt is handed two empty
    // strings and files the session under the wrong project, silently.
    writeFileSync(gate(), "");

    const realistic = JSON.stringify({
      session_id: CLAUDE_SID,
      transcript_path: "/transcripts/x.jsonl",
      cwd: "/work/repo",
      permission_mode: "default",
      hook_event_name: "UserPromptSubmit",
      prompt: "do the thing ".repeat(60),
    });
    expect(realistic.length).toBeGreaterThan(512);

    run("on-user-prompt.sh", realistic, untracked("create"));

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
