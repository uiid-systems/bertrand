import { describe, test, expect, afterEach } from "bun:test";

import { _setEnterpriseHosts } from "./hosts";
import {
  runGh,
  runGhJson,
  MAX_CONCURRENT_GH,
  _ghEnv,
  _setGhRunner,
  _setClock,
  _resetGhState,
  type GhFailureReason,
  type GhInvocation,
  type GhOutcome,
  type GhRunner,
} from "./gh";

/** Lets every pending microtask and timer-zero callback settle. */
const flush = () => new Promise<void>((done) => setTimeout(done, 0));

interface FakeGh {
  runner: GhRunner;
  /** One entry per process the runner would have spawned, in order. */
  calls: GhInvocation[];
}

/** A `gh` that answers with a fixed outcome, after a real microtask boundary. */
function fakeGh(outcome: GhOutcome | ((call: GhInvocation) => GhOutcome)): FakeGh {
  const calls: GhInvocation[] = [];

  const runner: GhRunner = async (invocation) => {
    calls.push(invocation);
    await Promise.resolve();

    return typeof outcome === "function" ? outcome(invocation) : outcome;
  };

  return { runner, calls };
}

/** A process that exited non-zero with the given stderr. */
const failed = (exitCode: number, stderr: string): GhOutcome => ({
  kind: "exited",
  exitCode,
  stdout: "",
  stderr,
});

const succeeded = (stdout: string): GhOutcome => ({
  kind: "exited",
  exitCode: 0,
  stdout,
  stderr: "",
});

afterEach(() => {
  _setGhRunner(null);
  _setClock(null);
  _setEnterpriseHosts(null);
  _resetGhState();
});

describe("runGh", () => {
  test("returns trimmed stdout when gh succeeds", async () => {
    const gh = fakeGh(succeeded("main\n"));
    _setGhRunner(gh.runner);

    const result = await runGh(["repo", "view"]);

    expect(result).toEqual({ ok: true, value: "main" });
    expect(gh.calls[0]?.args).toEqual(["repo", "view"]);
  });

  test("passes cwd through to the process", async () => {
    const gh = fakeGh(succeeded(""));
    _setGhRunner(gh.runner);

    await runGh(["pr", "list"], { cwd: "/repo" });

    expect(gh.calls[0]?.cwd).toBe("/repo");
  });
});

describe("failure classification", () => {
  /**
   * Stderr as `gh` actually writes it. The classifier matches on text `gh`
   * never promised to keep, so the samples are verbatim rather than invented —
   * a rewording upstream should break these tests, not production.
   */
  const cases: {
    name: string;
    exitCode: number;
    stderr: string;
    reason: GhFailureReason;
  }[] = [
    {
      name: "no credentials at all",
      exitCode: 4,
      stderr:
        "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.",
      reason: "not-authenticated",
    },
    {
      name: "expired or revoked credentials",
      exitCode: 1,
      stderr: "gh: Bad credentials (HTTP 401)",
      reason: "not-authenticated",
    },
    {
      name: "credentials without the scope",
      exitCode: 1,
      stderr: "gh: Resource not accessible by personal access token (HTTP 403)",
      reason: "not-authenticated",
    },
    {
      name: "missing or private resource",
      exitCode: 1,
      stderr: "gh: Not Found (HTTP 404)",
      reason: "not-found",
    },
    {
      name: "GraphQL resource that does not exist",
      exitCode: 1,
      stderr: "gh: Could not resolve to a Repository with the name 'uiid/nope'.",
      reason: "not-found",
    },
    {
      name: "secondary rate limit",
      exitCode: 1,
      stderr: "gh: You have exceeded a secondary rate limit. (HTTP 403)",
      reason: "rate-limited",
    },
    {
      name: "connection failure",
      exitCode: 1,
      stderr: "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com",
      reason: "network",
    },
    {
      name: "DNS failure surfaced raw",
      exitCode: 1,
      stderr: 'Get "https://api.github.com/user": dial tcp: lookup api.github.com: no such host',
      reason: "network",
    },
    {
      name: "GitHub itself is down",
      exitCode: 1,
      stderr: "gh: Server Error (HTTP 503)",
      reason: "network",
    },
    {
      name: "something we have never seen",
      exitCode: 1,
      stderr: "gh: unknown command \"frobnicate\" for \"gh\"",
      reason: "unknown",
    },
  ];

  for (const { name, exitCode, stderr, reason } of cases) {
    test(`classifies ${name} as ${reason}`, async () => {
      _setGhRunner(fakeGh(failed(exitCode, stderr)).runner);

      const result = await runGh(["api", "user"]);

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toBe(reason);
    });
  }

  /**
   * The one ambiguity that matters. A rate limit and a permission failure are
   * both HTTP 403; reading this as an auth problem sends the user to re-run
   * `gh auth login` against credentials that were never the problem.
   */
  test("reads a rate-limited 403 as rate-limited, not as an auth failure", async () => {
    _setGhRunner(
      fakeGh(failed(1, "gh: API rate limit exceeded for user ID 12345. (HTTP 403)")).runner,
    );

    const result = await runGh(["api", "user"]);

    expect(result.ok === false && result.reason).toBe("rate-limited");
  });

  test("carries gh's own message and exit code on the failure", async () => {
    _setGhRunner(fakeGh(failed(1, "gh: Not Found (HTTP 404)\n")).runner);

    const result = await runGh(["api", "repos/uiid/nope"]);

    expect(result.ok).toBe(false);

    if (result.ok) return;

    // The `gh: ` prefix is stripped — the message is bertrand's to show.
    expect(result.message).toBe("Not Found (HTTP 404)");
    expect(result.exitCode).toBe(1);
  });

  test("still produces a message when gh dies silently", async () => {
    _setGhRunner(fakeGh(failed(1, "")).runner);

    const result = await runGh(["api", "user"]);

    expect(result.ok === false && result.message.length).toBeGreaterThan(0);
  });

  test("reports a killed process as timed-out", async () => {
    _setGhRunner(fakeGh({ kind: "timed-out" }).runner);

    const result = await runGh(["api", "user"], { timeoutMs: 50 });

    expect(result.ok === false && result.reason).toBe("timed-out");
  });
});

describe("a missing gh binary", () => {
  /** What Bun throws when the executable is not on PATH. */
  function enoent(): GhOutcome {
    const error = Object.assign(new Error('Executable not found in $PATH: "gh"'), {
      code: "ENOENT",
    });

    return { kind: "spawn-failed", error };
  }

  test("degrades to a result rather than an exception", async () => {
    _setGhRunner(fakeGh(enoent()).runner);

    const result = await runGh(["api", "user"]);

    expect(result.ok === false && result.reason).toBe("gh-missing");
  });

  test("is remembered, so a polling caller stops spawning", async () => {
    const gh = fakeGh(enoent());
    _setGhRunner(gh.runner);

    await runGh(["api", "user"]);
    await runGh(["api", "user"]);
    await runGh(["api", "user"]);

    expect(gh.calls).toHaveLength(1);
  });

  test("is re-checked once the memo expires, so installing gh takes effect", async () => {
    let clock = 1_000;
    _setClock(() => clock);

    const gh = fakeGh((call) =>
      call.args[0] === "second" ? succeeded("ok") : enoent(),
    );
    _setGhRunner(gh.runner);

    expect((await runGh(["first"])).ok).toBe(false);

    clock += 6 * 60_000;

    expect(await runGh(["second"])).toEqual({ ok: true, value: "ok" });
    expect(gh.calls).toHaveLength(2);
  });
});

describe("concurrency cap", () => {
  /** A `gh` that never finishes until the test lets it. */
  function gatedGh() {
    let inFlight = 0;
    let peak = 0;
    let started = 0;
    const gates: (() => void)[] = [];

    const runner: GhRunner = async () => {
      inFlight++;
      started++;
      peak = Math.max(peak, inFlight);

      await new Promise<void>((open) => gates.push(open));

      inFlight--;

      return succeeded("");
    };

    return {
      runner,
      /** How many processes have been started, ever. */
      get started() {
        return started;
      },
      get peak() {
        return peak;
      },
      finishOne() {
        gates.shift()?.();
      },
      finishAll() {
        while (gates.length > 0) gates.shift()?.();
      },
    };
  }

  test("runs at most four gh processes at once", async () => {
    const gh = gatedGh();
    _setGhRunner(gh.runner);

    const calls = Array.from({ length: 12 }, (_, i) => runGh(["api", `user/${i}`]));

    await flush();

    expect(gh.started).toBe(MAX_CONCURRENT_GH);

    gh.finishOne();
    await flush();

    // The freed slot is handed to exactly one waiter, never to all of them.
    expect(gh.started).toBe(MAX_CONCURRENT_GH + 1);

    // Each round admits the next wave, so one round per call always drains.
    for (let round = 0; round < calls.length; round++) {
      gh.finishAll();
      await flush();
    }

    const results = await Promise.all(calls);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(gh.started).toBe(calls.length);
    expect(gh.peak).toBe(MAX_CONCURRENT_GH);
  });

  test("releases the slot when a call fails, so failures cannot wedge the cap", async () => {
    _setGhRunner(fakeGh(failed(1, "gh: Not Found (HTTP 404)")).runner);

    // More than the cap: if a failing call kept its slot, the cap would be
    // exhausted after four and this would never settle.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => runGh(["api", "user"])),
    );

    expect(results).toHaveLength(10);
    expect(results.every((result) => !result.ok)).toBe(true);
  });

  test("releases the slot when a runner throws outright", async () => {
    const runner: GhRunner = async () => {
      throw new Error("runner exploded");
    };
    _setGhRunner(runner);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => runGh(["api", "user"])),
    );

    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results[0]?.ok === false && results[0].reason).toBe("unknown");
  });
});

describe("enterprise hosts", () => {
  test("passes a declared host to the process", async () => {
    _setEnterpriseHosts(["github.acme.com"]);
    const gh = fakeGh(succeeded("{}"));
    _setGhRunner(gh.runner);

    const result = await runGh(["api", "user"], { host: "github.acme.com" });

    expect(result.ok).toBe(true);
    expect(gh.calls[0]?.host).toBe("github.acme.com");
  });

  /**
   * The reason ELKY-158 had to land first. A binding stored while a host was
   * declared outlives the declaration, and `gh` would dial whatever `GH_HOST`
   * says — so the check happens here, before a process exists.
   */
  test("refuses an undeclared host without spawning anything", async () => {
    _setEnterpriseHosts([]);
    const gh = fakeGh(succeeded("{}"));
    _setGhRunner(gh.runner);

    const result = await runGh(["api", "user"], { host: "github.com.evil.com" });

    expect(result.ok === false && result.reason).toBe("untrusted-host");
    expect(gh.calls).toHaveLength(0);
  });

  /**
   * A `GH_HOST` exported in the shell that launched bertrand would otherwise
   * be inherited, sending a call meant for github.com to a host the gate above
   * never saw. The destination is this module's decision, not the shell's.
   */
  test("never lets an ambient GH_HOST choose the destination", () => {
    const previous = process.env.GH_HOST;
    process.env.GH_HOST = "github.com.evil.com";

    try {
      expect(_ghEnv().GH_HOST).toBe("github.com");
      expect(_ghEnv("github.acme.com").GH_HOST).toBe("github.acme.com");
    } finally {
      if (previous === undefined) delete process.env.GH_HOST;
      else process.env.GH_HOST = previous;
    }
  });

  test("keeps the ambient credentials, which are the point of using gh", () => {
    const previous = process.env.GH_TOKEN;
    process.env.GH_TOKEN = "ghp_example";

    try {
      expect(_ghEnv().GH_TOKEN).toBe("ghp_example");
    } finally {
      if (previous === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = previous;
    }
  });

  test("needs no declaration for github.com", async () => {
    _setEnterpriseHosts([]);
    const gh = fakeGh(succeeded("ok"));
    _setGhRunner(gh.runner);

    expect(await runGh(["api", "user"])).toEqual({ ok: true, value: "ok" });
    expect(gh.calls).toHaveLength(1);
  });
});

describe("runGhJson", () => {
  test("parses stdout", async () => {
    _setGhRunner(fakeGh(succeeded('{"number":7,"title":"P4.10"}\n')).runner);

    const result = await runGhJson<{ number: number; title: string }>([
      "pr",
      "view",
      "--json",
      "number,title",
    ]);

    expect(result).toEqual({ ok: true, value: { number: 7, title: "P4.10" } });
  });

  test("reports unparseable output instead of throwing", async () => {
    _setGhRunner(fakeGh(succeeded("<html>Sign in to your network</html>")).runner);

    const result = await runGhJson(["pr", "view", "--json", "number"]);

    expect(result.ok === false && result.reason).toBe("invalid-json");
  });

  test("truncates the offending output in the message", async () => {
    _setGhRunner(fakeGh(succeeded("x".repeat(5_000))).runner);

    const result = await runGhJson(["pr", "list"]);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message.length).toBeLessThan(300);
  });

  test("passes a transport failure straight through", async () => {
    _setGhRunner(fakeGh(failed(1, "gh: Not Found (HTTP 404)")).runner);

    const result = await runGhJson(["pr", "view", "--json", "number"]);

    expect(result.ok === false && result.reason).toBe("not-found");
  });
});
