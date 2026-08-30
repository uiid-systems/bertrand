import { describe, expect, test } from "bun:test";
import { githubRefLabel, parseGithubUrl, type GithubRef } from "./web-url";

describe("parseGithubUrl", () => {
  test("classifies a pull request URL", () => {
    expect(
      parseGithubUrl("https://github.com/uiid-systems/orca/pull/220"),
    ).toEqual({ kind: "pr", owner: "uiid-systems", repo: "orca", number: "220" });
  });

  test("classifies an issue URL", () => {
    expect(
      parseGithubUrl("https://github.com/uiid-systems/orca/issues/38"),
    ).toEqual({
      kind: "issue",
      owner: "uiid-systems",
      repo: "orca",
      number: "38",
    });
  });

  test("classifies a commit URL", () => {
    expect(
      parseGithubUrl("https://github.com/uiid-systems/orca/commit/abc1234def"),
    ).toEqual({
      kind: "commit",
      owner: "uiid-systems",
      repo: "orca",
      sha: "abc1234def",
    });
  });

  test("classifies repo and user URLs", () => {
    expect(parseGithubUrl("https://github.com/uiid-systems/orca")).toEqual({
      kind: "repo",
      owner: "uiid-systems",
      repo: "orca",
    });
    expect(parseGithubUrl("https://github.com/adamfratino")).toEqual({
      kind: "user",
      login: "adamfratino",
    });
  });

  test("deeper links degrade to the repo", () => {
    expect(
      parseGithubUrl("https://github.com/uiid-systems/orca/blob/main/src/x.ts"),
    ).toEqual({ kind: "repo", owner: "uiid-systems", repo: "orca" });
  });

  test("PR sub-pages still classify as the PR", () => {
    expect(
      parseGithubUrl("https://github.com/uiid-systems/orca/pull/220/files"),
    ).toEqual({ kind: "pr", owner: "uiid-systems", repo: "orca", number: "220" });
  });

  test("reserved top-level paths are site chrome, not users", () => {
    expect(parseGithubUrl("https://github.com/features")).toBeNull();
  });

  test("non-GitHub hosts return null", () => {
    expect(parseGithubUrl("https://example.com/owner/repo/pull/220")).toBeNull();
    expect(parseGithubUrl("https://gitlab.com/owner/repo")).toBeNull();
  });

  test("non-http protocols and malformed URLs return null", () => {
    expect(parseGithubUrl("ftp://github.com/owner/repo")).toBeNull();
    expect(parseGithubUrl("not a url")).toBeNull();
  });

  test("www.github.com is accepted", () => {
    expect(parseGithubUrl("https://www.github.com/uiid-systems/orca")).toEqual({
      kind: "repo",
      owner: "uiid-systems",
      repo: "orca",
    });
  });
});

describe("githubRefLabel", () => {
  test("labels each ref kind compactly", () => {
    const cases: Array<[GithubRef, string]> = [
      [{ kind: "pr", owner: "o", repo: "r", number: "1" }, "o/r#1"],
      [{ kind: "issue", owner: "o", repo: "r", number: "2" }, "o/r#2"],
      [{ kind: "commit", owner: "o", repo: "r", sha: "abc1234def" }, "o/r@abc1234"],
      [{ kind: "repo", owner: "o", repo: "r" }, "o/r"],
      [{ kind: "user", login: "o" }, "@o"],
    ];
    for (const [ref, label] of cases) expect(githubRefLabel(ref)).toBe(label);
  });
});
