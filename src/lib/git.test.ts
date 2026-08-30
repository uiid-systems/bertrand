import { afterAll, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { getCurrentBranch, parseNameStatus, parseNumstat } from "./git";

describe("parseNumstat", () => {
  test("parses added/removed counts per path", () => {
    const out = "12\t3\tsrc/app.tsx\n0\t189\tsrc/pages/old-page.tsx\n";
    const counts = parseNumstat(out);
    expect(counts.get("src/app.tsx")).toEqual({ added: 12, removed: 3 });
    expect(counts.get("src/pages/old-page.tsx")).toEqual({ added: 0, removed: 189 });
  });

  test("binary files ('-' counts) parse as null", () => {
    const counts = parseNumstat("-\t-\tassets/logo.png\n");
    expect(counts.get("assets/logo.png")).toEqual({ added: null, removed: null });
  });

  test("ignores blank lines and keeps tabs inside paths", () => {
    const counts = parseNumstat("\n1\t1\tweird\tpath.txt\n\n");
    expect(counts.size).toBe(1);
    expect(counts.get("weird\tpath.txt")).toEqual({ added: 1, removed: 1 });
  });
});

describe("parseNameStatus", () => {
  test("maps A/D/M letters to statuses", () => {
    const statuses = parseNameStatus(
      "A\tsrc/new.ts\nD\tsrc/gone.ts\nM\tsrc/edited.ts\n",
    );
    expect(statuses.get("src/new.ts")).toBe("added");
    expect(statuses.get("src/gone.ts")).toBe("deleted");
    expect(statuses.get("src/edited.ts")).toBe("modified");
  });

  test("unknown letters fall back to modified, blanks are skipped", () => {
    const statuses = parseNameStatus("T\tsrc/typechange.ts\n\n");
    expect(statuses.size).toBe(1);
    expect(statuses.get("src/typechange.ts")).toBe("modified");
  });
});

/**
 * A real repo, because the thing under test is what git actually prints for a
 * directory. `getCurrentBranch` is what lets a session record the branch it ran
 * on — the record every branch-derived feature was missing.
 */
const GIT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-branch-test-")));
const repo = join(GIT_DIR, "repo");

afterAll(() => rmSync(GIT_DIR, { recursive: true, force: true }));

describe("getCurrentBranch", () => {
  test("returns the checked-out branch name", async () => {
    await $`mkdir -p ${repo}`.quiet();
    await $`git -C ${repo} init -q -b trunk`.quiet();
    await $`git -C ${repo} config user.email t@example.com`.quiet();
    await $`git -C ${repo} config user.name Test`.quiet();
    writeFileSync(join(repo, "a.txt"), "hello\n");
    await $`git -C ${repo} add -A`.quiet();
    await $`git -C ${repo} commit -qm init`.quiet();

    expect(await getCurrentBranch(repo)).toBe("trunk");

    await $`git -C ${repo} checkout -q -b feature/thing`.quiet();
    expect(await getCurrentBranch(repo)).toBe("feature/thing");
  });

  test("returns null in detached HEAD rather than the string 'HEAD'", async () => {
    const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
    await $`git -C ${repo} checkout -q ${head}`.quiet();
    expect(await getCurrentBranch(repo)).toBeNull();
    await $`git -C ${repo} checkout -q feature/thing`.quiet();
  });

  test("returns null outside a git repo — bertrand logs non-repo sessions", async () => {
    const loose = join(GIT_DIR, "loose");
    await $`mkdir -p ${loose}`.quiet();
    expect(await getCurrentBranch(loose)).toBeNull();
  });

  test("returns null for a directory that does not exist", async () => {
    expect(await getCurrentBranch(join(GIT_DIR, "nope"))).toBeNull();
  });
});
