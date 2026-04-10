import { describe, test, expect } from "bun:test";
import { parseSessionName } from "./parse-session-name.ts";

describe("parseSessionName", () => {
  test("two segments: group/session", () => {
    expect(parseSessionName("project/my-session")).toEqual({
      groupPath: "project",
      slug: "my-session",
    });
  });

  test("three segments: group/subgroup/session", () => {
    expect(parseSessionName("uiid/bertrand/fix-auth")).toEqual({
      groupPath: "uiid/bertrand",
      slug: "fix-auth",
    });
  });

  test("deep nesting: any depth", () => {
    expect(parseSessionName("a/b/c/d/my-session")).toEqual({
      groupPath: "a/b/c/d",
      slug: "my-session",
    });
  });

  test("trims leading/trailing slashes", () => {
    expect(parseSessionName("/project/session/")).toEqual({
      groupPath: "project",
      slug: "session",
    });
  });

  test("trims whitespace", () => {
    expect(parseSessionName("  project/session  ")).toEqual({
      groupPath: "project",
      slug: "session",
    });
  });

  test("rejects empty input", () => {
    expect(() => parseSessionName("")).toThrow("cannot be empty");
    expect(() => parseSessionName("   ")).toThrow("cannot be empty");
  });

  test("rejects single segment (no group)", () => {
    expect(() => parseSessionName("my-session")).toThrow("at least one group");
  });

  test("rejects invalid characters", () => {
    expect(() => parseSessionName("project/my session")).toThrow("Invalid segment");
    expect(() => parseSessionName("project/my@session")).toThrow("Invalid segment");
  });

  test("rejects segments starting with non-alphanumeric", () => {
    expect(() => parseSessionName("project/-session")).toThrow("Invalid segment");
    expect(() => parseSessionName(".hidden/session")).toThrow("Invalid segment");
  });

  test("allows dots, underscores, and dashes", () => {
    expect(parseSessionName("my.org/my_project/fix-bug.1")).toEqual({
      groupPath: "my.org/my_project",
      slug: "fix-bug.1",
    });
  });
});
