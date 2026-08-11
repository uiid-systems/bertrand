import { describe, test, expect, afterEach } from "bun:test";

import { _setEnterpriseHosts } from "./hosts";
import {
  _setGhRunner,
  _resetGhState,
  _setClock as _setGhClock,
  type GhInvocation,
  type GhOutcome,
  type GhRunner,
} from "./gh";
import {
  getPRForBranch,
  getPRChecks,
  _resetPRCache,
  _setClock,
} from "./pr";
import type { CheckBucket, ProviderIdentity } from "./types";

/** Lets every pending microtask settle. */
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

/** A `gh pr list` that answered with these rows. */
function listed(rows: unknown[]): FakeGh {
  return fakeGh({
    kind: "exited",
    exitCode: 0,
    stdout: JSON.stringify(rows),
    stderr: "",
  });
}

const failed = (exitCode: number, stderr: string): GhOutcome => ({
  kind: "exited",
  exitCode,
  stdout: "",
  stderr,
});

const IDENTITY: ProviderIdentity = {
  provider: "github",
  owner: "uiid-systems",
  repo: "bertrand",
};

/**
 * Verbatim from `gh pr list --json number,statusCheckRollup` against
 * uiid-systems/bertrand#248 — both arms GitHub actually sends, including the
 * `StatusContext` that a `CheckRun`-only parser would drop.
 */
const REAL_ROLLUP = [
  {
    __typename: "CheckRun",
    completedAt: "2026-08-10T03:50:48Z",
    conclusion: "SUCCESS",
    detailsUrl:
      "https://github.com/uiid-systems/bertrand/actions/runs/31353708515/job/93349239401",
    name: "test",
    startedAt: "2026-08-10T03:50:20Z",
    status: "COMPLETED",
    workflowName: "test",
  },
  {
    __typename: "StatusContext",
    context: "Vercel",
    startedAt: "2026-08-10T03:50:45Z",
    state: "SUCCESS",
    targetUrl: "https://vercel.com/shrimpboat/bertrand/J4eqxpqxrUMQQUuY2uX7RrELhQZC",
  },
];

function prRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 248,
    state: "MERGED",
    isDraft: false,
    title: "refactor: tinkering",
    url: "https://github.com/uiid-systems/bertrand/pull/248",
    mergeable: "UNKNOWN",
    headRefName: "tinkering-sidebar-chrome",
    statusCheckRollup: REAL_ROLLUP,
    ...overrides,
  };
}

/** Unwraps a lookup that is expected to have succeeded. */
function expectPR(result: Awaited<ReturnType<typeof getPRForBranch>>) {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.reason}: ${result.message}`);
  }

  if (!result.value) {
    throw new Error("expected a PR, got null");
  }

  return result.value;
}

afterEach(() => {
  _setGhRunner(null);
  _setGhClock(null);
  _setClock(null);
  _setEnterpriseHosts(null);
  _resetGhState();
  _resetPRCache();
});

describe("getPRForBranch", () => {
  test("returns the PR's number, state, draft, title, url and mergeable", async () => {
    _setGhRunner(listed([prRow({ state: "OPEN", isDraft: true, mergeable: "MERGEABLE" })]).runner);

    const pr = expectPR(await getPRForBranch(IDENTITY, "tinkering-sidebar-chrome"));

    expect(pr.number).toBe(248);
    expect(pr.state).toBe("OPEN");
    expect(pr.isDraft).toBe(true);
    expect(pr.title).toBe("refactor: tinkering");
    expect(pr.url).toBe("https://github.com/uiid-systems/bertrand/pull/248");
    expect(pr.mergeable).toBe("MERGEABLE");
    expect(pr.headRefName).toBe("tinkering-sidebar-chrome");
  });

  test("no PR for the branch is a success, not a failure", async () => {
    const gh = listed([]);
    _setGhRunner(gh.runner);

    const result = await getPRForBranch(IDENTITY, "no-such-branch");

    expect(result).toEqual({ ok: true, value: null });
  });

  test("a blank branch resolves to null without spawning gh", async () => {
    // `gh pr list --head ""` is no filter at all, so it would answer with the
    // repo's newest PR and attach it to a session that has none.
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    expect(await getPRForBranch(IDENTITY, "")).toEqual({ ok: true, value: null });
    expect(await getPRForBranch(IDENTITY, "   ")).toEqual({ ok: true, value: null });
    expect(gh.calls).toHaveLength(0);
  });

  test("asks gh for the branch, every state, and the check rollup", async () => {
    const gh = listed([]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "elky-153");

    const args = gh.calls[0]!.args;

    expect(args.slice(0, 2)).toEqual(["pr", "list"]);
    expect(args).toContain("--head");
    expect(args[args.indexOf("--head") + 1]).toBe("elky-153");
    expect(args[args.indexOf("--repo") + 1]).toBe("uiid-systems/bertrand");
    // Merged and closed PRs are part of the answer.
    expect(args[args.indexOf("--state") + 1]).toBe("all");
    expect(args[args.indexOf("--json") + 1]).toContain("statusCheckRollup");
  });

  test("routes an enterprise host through the transport, not through --repo", async () => {
    _setEnterpriseHosts(["github.acme.com"]);
    const gh = listed([]);
    _setGhRunner(gh.runner);

    await getPRForBranch({ ...IDENTITY, host: "github.acme.com" }, "elky-153");

    const call = gh.calls[0]!;

    // The host reaches `gh` only as GH_HOST, which the transport gates against
    // this machine's declared hosts. Embedding it in `--repo` would be a second
    // route to the same decision, and an ungated one.
    expect(call.host).toBe("github.acme.com");
    expect(call.args[call.args.indexOf("--repo") + 1]).toBe("uiid-systems/bertrand");
  });

  test("prefers an open PR over an older merged one on the same branch", async () => {
    // A reused branch has both. `gh` returns newest first.
    _setGhRunner(
      listed([
        prRow({ number: 300, state: "CLOSED" }),
        prRow({ number: 299, state: "OPEN" }),
        prRow({ number: 250, state: "MERGED" }),
      ]).runner,
    );

    expect(expectPR(await getPRForBranch(IDENTITY, "reused")).number).toBe(299);
  });

  test("falls back to the newest PR when none is open", async () => {
    _setGhRunner(
      listed([prRow({ number: 300, state: "MERGED" }), prRow({ number: 250, state: "CLOSED" })])
        .runner,
    );

    expect(expectPR(await getPRForBranch(IDENTITY, "reused")).number).toBe(300);
  });

  test("a host this machine no longer declares is refused before gh runs", async () => {
    _setEnterpriseHosts([]);
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    const result = await getPRForBranch({ ...IDENTITY, host: "github.acme.com" }, "b");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("untrusted-host");
    expect(gh.calls).toHaveLength(0);
  });

  test("passes a gh failure through untouched", async () => {
    _setGhRunner(fakeGh(failed(4, "gh: To get started with GitHub CLI, please run: gh auth login")).runner);

    const result = await getPRForBranch(IDENTITY, "elky-153");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("not-authenticated");
  });

  test("an unrecognized mergeable value degrades to UNKNOWN", async () => {
    _setGhRunner(listed([prRow({ mergeable: "SOMETHING_NEW" })]).runner);

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).mergeable).toBe("UNKNOWN");
  });

  test("skips rows that are not usable pull requests", async () => {
    _setGhRunner(listed([null, "nonsense", { number: "248" }, prRow({ number: 7 })]).runner);

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).number).toBe(7);
  });
});

describe("check normalization", () => {
  test("reads both the CheckRun and StatusContext arms of the rollup", async () => {
    _setGhRunner(listed([prRow()]).runner);

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    // The Vercel entry is a StatusContext with no `name` and no `conclusion`.
    // A CheckRun-only parser drops it and reports a green PR mid-deploy.
    expect(pr.checks.map((check) => check.name)).toEqual(["test", "Vercel"]);
    expect(pr.checks.map((check) => check.bucket)).toEqual(["pass", "pass"]);
    expect(pr.rollup).toBe("pass");
  });

  test("carries the url, workflow and timestamps for a check run", async () => {
    _setGhRunner(listed([prRow()]).runner);

    const [run, status] = expectPR(await getPRForBranch(IDENTITY, "b")).checks;

    expect(run).toMatchObject({
      name: "test",
      state: "SUCCESS",
      workflow: "test",
      startedAt: "2026-08-10T03:50:20Z",
      completedAt: "2026-08-10T03:50:48Z",
      url: "https://github.com/uiid-systems/bertrand/actions/runs/31353708515/job/93349239401",
    });

    expect(status).toMatchObject({
      name: "Vercel",
      state: "SUCCESS",
      url: "https://vercel.com/shrimpboat/bertrand/J4eqxpqxrUMQQUuY2uX7RrELhQZC",
    });
    // A commit status belongs to no workflow and reports no completion time.
    expect(status).not.toHaveProperty("workflow");
    expect(status).not.toHaveProperty("completedAt");
  });

  test("an unfinished check run reports its status, not an empty conclusion", async () => {
    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: [
            { __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: "" },
            { __typename: "CheckRun", name: "lint", status: "QUEUED", conclusion: "" },
          ],
        }),
      ]).runner,
    );

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    expect(pr.checks.map((check) => check.state)).toEqual(["IN_PROGRESS", "QUEUED"]);
    expect(pr.checks.map((check) => check.bucket)).toEqual(["pending", "pending"]);
    expect(pr.rollup).toBe("pending");
  });

  test("maps conclusions and commit-status states onto buckets", async () => {
    const cases: [string, CheckBucket][] = [
      ["SUCCESS", "pass"],
      ["FAILURE", "fail"],
      ["TIMED_OUT", "fail"],
      ["ACTION_REQUIRED", "fail"],
      ["STARTUP_FAILURE", "fail"],
      ["STALE", "fail"],
      ["ERROR", "fail"],
      ["CANCELLED", "cancel"],
      ["SKIPPED", "skipping"],
      ["NEUTRAL", "skipping"],
      ["PENDING", "pending"],
      ["EXPECTED", "pending"],
      ["A_STATE_GITHUB_ADDED_LATER", "pending"],
    ];

    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: cases.map(([state], index) => ({
            __typename: "CheckRun",
            name: `check-${index}`,
            status: "COMPLETED",
            conclusion: state,
          })),
        }),
      ]).runner,
    );

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    expect(pr.checks.map((check) => check.bucket)).toEqual(cases.map(([, bucket]) => bucket));
  });

  test("a failing check outranks one that is still running", async () => {
    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: [
            { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
            { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: "" },
          ],
        }),
      ]).runner,
    );

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).rollup).toBe("fail");
  });

  test("a cancelled run is not a passing PR", async () => {
    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: [
            { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
            { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "CANCELLED" },
          ],
        }),
      ]).runner,
    );

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).rollup).toBe("fail");
  });

  test("skipped checks alone still count as passing", async () => {
    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: [
            { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
            { __typename: "CheckRun", name: "e2e", status: "COMPLETED", conclusion: "SKIPPED" },
          ],
        }),
      ]).runner,
    );

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).rollup).toBe("pass");
  });

  test("a PR with no checks rolls up to none, not pass", async () => {
    _setGhRunner(listed([prRow({ statusCheckRollup: [] })]).runner);

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    expect(pr.checks).toEqual([]);
    // Nothing was verified, so nothing may be claimed.
    expect(pr.rollup).toBe("none");
  });

  test("keeps a nameless check rather than losing its verdict", async () => {
    _setGhRunner(
      listed([
        prRow({
          statusCheckRollup: [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "FAILURE" }],
        }),
      ]).runner,
    );

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    expect(pr.checks).toHaveLength(1);
    expect(pr.rollup).toBe("fail");
  });

  test("identifies a commit status with no __typename by its shape", async () => {
    _setGhRunner(
      listed([prRow({ statusCheckRollup: [{ context: "Vercel", state: "FAILURE" }] })]).runner,
    );

    const pr = expectPR(await getPRForBranch(IDENTITY, "b"));

    expect(pr.checks[0]).toMatchObject({ name: "Vercel", bucket: "fail" });
  });

  test("survives a rollup that is missing or not an array", async () => {
    _setGhRunner(listed([prRow({ statusCheckRollup: null })]).runner);

    expect(expectPR(await getPRForBranch(IDENTITY, "b")).rollup).toBe("none");
  });
});

describe("caching and coalescing", () => {
  test("a second lookup inside the TTL spawns no gh process", async () => {
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    await getPRForBranch(IDENTITY, "b");
    await getPRForBranch(IDENTITY, "b");

    expect(gh.calls).toHaveLength(1);
  });

  test("concurrent lookups for one branch share a single gh process", async () => {
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    const results = await Promise.all([
      getPRForBranch(IDENTITY, "b"),
      getPRForBranch(IDENTITY, "b"),
      getPRForBranch(IDENTITY, "b"),
    ]);

    expect(gh.calls).toHaveLength(1);
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
  });

  test("a lookup after the TTL expires asks gh again", async () => {
    let clock = 1_000;
    _setClock(() => clock);

    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    clock += 29_000;
    await getPRForBranch(IDENTITY, "b");
    expect(gh.calls).toHaveLength(1);

    clock += 2_000;
    await getPRForBranch(IDENTITY, "b");
    expect(gh.calls).toHaveLength(2);
  });

  test("failures are cached too, so a logged-out gh is not re-spawned per poll", async () => {
    let clock = 1_000;
    _setClock(() => clock);

    const gh = fakeGh(failed(4, "gh auth login"));
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    await getPRForBranch(IDENTITY, "b");
    expect(gh.calls).toHaveLength(1);

    // ...but not so long that fixing the auth goes unnoticed.
    clock += 61_000;
    await getPRForBranch(IDENTITY, "b");
    expect(gh.calls).toHaveLength(2);
  });

  test("different branches in one repo are cached separately", async () => {
    const gh = fakeGh((call) => {
      const branch = call.args[call.args.indexOf("--head") + 1]!;

      return {
        kind: "exited",
        exitCode: 0,
        stdout: JSON.stringify([prRow({ headRefName: branch, number: branch.length })]),
        stderr: "",
      };
    });
    _setGhRunner(gh.runner);

    expect(expectPR(await getPRForBranch(IDENTITY, "aa")).number).toBe(2);
    expect(expectPR(await getPRForBranch(IDENTITY, "aaa")).number).toBe(3);
    expect(gh.calls).toHaveLength(2);
  });

  test("owner and repo share a cache entry across casings, branches do not", async () => {
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    // GitHub treats owner/repo case-insensitively.
    await getPRForBranch({ ...IDENTITY, owner: "UIID-Systems", repo: "Bertrand" }, "b");
    expect(gh.calls).toHaveLength(1);

    // Git refs are case-sensitive; `B` is a different branch than `b`.
    await getPRForBranch(IDENTITY, "B");
    expect(gh.calls).toHaveLength(2);
  });

  test("the same branch on two hosts does not share an entry", async () => {
    _setEnterpriseHosts(["github.acme.com"]);
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    await getPRForBranch({ ...IDENTITY, host: "github.acme.com" }, "b");

    expect(gh.calls).toHaveLength(2);
  });

  test("an in-flight lookup is not left behind after it settles", async () => {
    let clock = 1_000;
    _setClock(() => clock);

    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    await flush();

    clock += 31_000;
    await getPRForBranch(IDENTITY, "b");

    expect(gh.calls).toHaveLength(2);
  });
});

describe("getPRChecks", () => {
  test("returns the checks for the branch's PR", async () => {
    _setGhRunner(listed([prRow()]).runner);

    const result = await getPRChecks(IDENTITY, "b");

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.value?.map((check) => check.name)).toEqual([
      "test",
      "Vercel",
    ]);
  });

  test("null when the branch has no PR, empty when the PR has no checks", async () => {
    const gh = fakeGh((call) => ({
      kind: "exited",
      exitCode: 0,
      stdout:
        call.args[call.args.indexOf("--head") + 1] === "bare"
          ? JSON.stringify([prRow({ statusCheckRollup: [] })])
          : "[]",
      stderr: "",
    }));
    _setGhRunner(gh.runner);

    // No PR at all.
    expect(await getPRChecks(IDENTITY, "none")).toEqual({ ok: true, value: null });
    // A PR exists; nothing is checking it.
    expect(await getPRChecks(IDENTITY, "bare")).toEqual({ ok: true, value: [] });
  });

  test("shares the PR lookup's cache instead of spawning its own gh", async () => {
    const gh = listed([prRow()]);
    _setGhRunner(gh.runner);

    await getPRForBranch(IDENTITY, "b");
    await getPRChecks(IDENTITY, "b");

    expect(gh.calls).toHaveLength(1);
  });

  test("passes a gh failure through", async () => {
    _setGhRunner(fakeGh(failed(1, "error connecting to api.github.com")).runner);

    const result = await getPRChecks(IDENTITY, "b");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("network");
  });
});
