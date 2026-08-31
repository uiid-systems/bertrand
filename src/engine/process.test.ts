import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildClaudeEnv } from "./process";
import { spawnPty } from "./pty";

/**
 * The `...process.env` spread in `buildClaudeEnv` is load-bearing (ELKY-176).
 *
 * bertrand's environment is the only channel a host has into a session
 * bertrand launched: whatever the host set is inherited by `claude`, and then
 * by every hook subprocess `claude` spawns, and then by the `bertrand update`
 * those hooks run. Orca composes with bertrand through nothing but that
 * inheritance (`ORCA_*`, docs/orca-boundary.md) — no import, no config, no
 * agreement. Narrow the spread to an allowlist of the names bertrand happens
 * to know about today and every such host goes blind, silently, with no
 * failing call to point at.
 *
 * So these tests are deliberately written against *arbitrary* variable names,
 * including one with no recognizable prefix. Any allowlist fails them.
 */

const OPTS = {
  sessionId: "sess_test",
  claudeId: "11111111-2222-3333-4444-555555555555",
  sessionName: "env-spread",
  sessionSlug: "env-spread",
};

/** A host's var, and one that looks like nothing bertrand would think to keep. */
const HOST_VAR = "ORCA_AGENT_LAUNCH_TOKEN";
const ARBITRARY_VAR = "ZZ_UNRELATED_HOST_VAR";
const HOST_VALUE = "orca-token-abc123";
const ARBITRARY_VALUE = "arbitrary-xyz789";

/**
 * `buildClaudeEnv`'s inferred type lists only the keys it writes itself — an
 * object spread drops the index signature `process.env` carries, so the
 * arbitrary names these tests are *about* aren't indexable on it. The runtime
 * value is the full environment; this view says so.
 */
const envFor = (opts: typeof OPTS) =>
  buildClaudeEnv(opts) as Record<string, string | undefined>;

const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const [key, value] of [
    [HOST_VAR, HOST_VALUE],
    [ARBITRARY_VAR, ARBITRARY_VALUE],
  ] as const) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("buildClaudeEnv", () => {
  test("passes the whole environment through, not an allowlist", () => {
    const env = envFor(OPTS);
    expect(env[HOST_VAR]).toBe(HOST_VALUE);
    expect(env[ARBITRARY_VAR]).toBe(ARBITRARY_VALUE);
  });

  test("adds the BERTRAND_* identity vars hooks resolve the session from", () => {
    const env = envFor(OPTS);
    expect(env.BERTRAND_SESSION).toBe(OPTS.sessionId);
    expect(env.BERTRAND_CLAUDE_ID).toBe(OPTS.claudeId);
    expect(env.BERTRAND_SESSION_NAME).toBe(OPTS.sessionName);
    expect(env.BERTRAND_SESSION_SLUG).toBe(OPTS.sessionSlug);
    // Value depends on the machine's registry; that it is set at all is the
    // contract — it is what pins a session's writes to one project DB.
    expect(env.BERTRAND_PROJECT).toBeTruthy();
    expect(env.BERTRAND_PROJECT_DB).toBeTruthy();
  });

  test("does not let its own vars be overwritten by the inherited ones", () => {
    saved.set("BERTRAND_SESSION", process.env.BERTRAND_SESSION);
    process.env.BERTRAND_SESSION = "stale-from-an-outer-session";
    try {
      expect(buildClaudeEnv(OPTS).BERTRAND_SESSION).toBe(OPTS.sessionId);
    } finally {
      delete process.env.BERTRAND_SESSION;
    }
  });

  /**
   * The object is only half the claim — it also has to survive the spawn. This
   * runs the same `spawnPty` call `launchClaude` makes, with `sh` standing in
   * for `claude`, and reads the variables back out of the child.
   */
  test("the vars reach the spawned child process", async () => {
    const script = `printf '<%s|%s|%s>' "$${HOST_VAR}" "$${ARBITRARY_VAR}" "$BERTRAND_SESSION"`;
    const output = await new Promise<string>((resolve) => {
      let out = "";
      const pty = spawnPty(["sh", "-c", script], {
        env: buildClaudeEnv(OPTS),
        onData: (chunk) => {
          out += Buffer.from(chunk).toString();
          if (out.includes(">")) resolve(out);
        },
      });
      // Backstop: if the child prints nothing we still finish and fail on the
      // assertion below rather than hanging out the test timeout.
      void pty.exited.then(() => setTimeout(() => resolve(out), 100));
    });

    expect(output).toContain(`<${HOST_VALUE}|${ARBITRARY_VALUE}|${OPTS.sessionId}>`);
  }, 15_000);
});
