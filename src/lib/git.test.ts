import { afterAll, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  getWorktreeChangedFiles,
  parseNameStatus,
  parseNumstat,
} from "./git";

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
 * A real repo and a real worktree. The parser tests above pin the string
 * handling; this pins the thing the dashboard actually depends on — that the
 * numbers `getWorktreeChangedFiles` reports are the ones `git diff --numstat`
 * reports, across the merge base, a committed change, an uncommitted change
 * on top of it, and an untracked file.
 */
const GIT_DIR = realpathSync(mkdtempSync(join(tmpdir(), "bertrand-git-test-")));
const repo = join(GIT_DIR, "repo");
const wt = join(GIT_DIR, "wt");

mkdirSync(repo);
await $`git init -b main ${repo}`.quiet();
await $`git -C ${repo} config user.email test@example.com`.quiet();
await $`git -C ${repo} config user.name Test`.quiet();
await $`git -C ${repo} config commit.gpgsign false`.quiet();

writeFileSync(join(repo, "a.txt"), "l1\nl2\nl3\n");
writeFileSync(join(repo, "untouched.txt"), "keep\n");
await $`git -C ${repo} add -A`.quiet();
await $`git -C ${repo} commit -m base`.quiet();

await $`git -C ${repo} worktree add -b feature ${wt}`.quiet();

// Committed on the branch: a.txt gains 2 lines, c.txt is new with 4.
writeFileSync(join(wt, "a.txt"), "l1\nl2\nl3\nl4\nl5\n");
writeFileSync(join(wt, "c.txt"), "c1\nc2\nc3\nc4\n");
await $`git -C ${wt} add -A`.quiet();
await $`git -C ${wt} commit -m feature`.quiet();

// Uncommitted on top: a.txt gains 1 more line, plus an untracked file.
writeFileSync(join(wt, "a.txt"), "l1\nl2\nl3\nl4\nl5\nl6\n");
writeFileSync(join(wt, "untracked.txt"), "u1\n");

afterAll(() => rmSync(GIT_DIR, { recursive: true, force: true }));

describe("getWorktreeChangedFiles against a real worktree", () => {
  test("counts committed and uncommitted work together, against the merge base", async () => {
    const { base, files } = await getWorktreeChangedFiles(wt);

    const mergeBase = (await $`git -C ${wt} merge-base HEAD main`.text()).trim();
    expect(base).toBe(mergeBase);

    expect(files).toEqual([
      // 2 committed + 1 uncommitted, counted once as the branch's net change —
      // the event replay would have counted each rewrite of the file in full.
      { path: "a.txt", added: 3, removed: 0, status: "modified" },
      { path: "c.txt", added: 4, removed: 0, status: "added" },
      { path: "untracked.txt", added: null, removed: null, status: "untracked" },
    ]);
    // A file the branch never touched stays out of the list entirely.
    expect(files.some((f) => f.path === "untouched.txt")).toBe(false);
  });

  test("line counts match git diff --numstat exactly", async () => {
    const { base, files } = await getWorktreeChangedFiles(wt);
    const numstat = parseNumstat(
      await $`git -C ${wt} diff --numstat --no-renames ${base}`.text(),
    );

    // Untracked files have no numstat row — git only counts what it tracks.
    const tracked = files.filter((f) => f.status !== "untracked");
    expect(tracked.length).toBe(numstat.size);
    for (const file of tracked) {
      expect({ added: file.added, removed: file.removed }).toEqual(
        numstat.get(file.path)!,
      );
    }
  });

  test("a removed line is counted as removed", async () => {
    writeFileSync(join(wt, "a.txt"), "l1\n");
    const { files } = await getWorktreeChangedFiles(wt);
    // Net against the 3-line base: nothing added, two lines gone.
    expect(files.find((f) => f.path === "a.txt")).toEqual({
      path: "a.txt",
      added: 0,
      removed: 2,
      status: "modified",
    });
    writeFileSync(join(wt, "a.txt"), "l1\nl2\nl3\nl4\nl5\nl6\n");
  });
});
