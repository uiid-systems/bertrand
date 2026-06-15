import { describe, test, expect } from "bun:test";
import { parseSessionName } from "./parse-session-name";

describe("parseSessionName", () => {
  test("two segments: category/session", () => {
    expect(parseSessionName("project/my-session")).toEqual({
      categoryPath: "project",
      slug: "my-session",
    });
  });

  test("three segments: category/rest joined into slug", () => {
    expect(parseSessionName("ssp/REV-367/fe-determination")).toEqual({
      categoryPath: "ssp",
      slug: "REV-367/fe-determination",
    });
  });

  test("deep nesting collapses into slug", () => {
    expect(parseSessionName("a/b/c/d/my-session")).toEqual({
      categoryPath: "a",
      slug: "b/c/d/my-session",
    });
  });

  test("trims leading/trailing slashes", () => {
    expect(parseSessionName("/project/session/")).toEqual({
      categoryPath: "project",
      slug: "session",
    });
  });

  test("trims whitespace", () => {
    expect(parseSessionName("  project/session  ")).toEqual({
      categoryPath: "project",
      slug: "session",
    });
  });

  test("rejects empty input", () => {
    expect(() => parseSessionName("")).toThrow("cannot be empty");
    expect(() => parseSessionName("   ")).toThrow("cannot be empty");
  });

  test("rejects single segment (no category)", () => {
    expect(() => parseSessionName("my-session")).toThrow("at least one category");
  });

  test("rejects invalid characters", () => {
    expect(() => parseSessionName("project/my session")).toThrow("Invalid segment");
    expect(() => parseSessionName("project/my@session")).toThrow("Invalid segment");
  });

  test("rejects segments starting with non-alphanumeric", () => {
    expect(() => parseSessionName("project/-session")).toThrow("Invalid segment");
    expect(() => parseSessionName(".hidden/session")).toThrow("Invalid segment");
  });

  test("validates every segment in a deep slug", () => {
    expect(() => parseSessionName("ssp/REV-367/bad segment")).toThrow("Invalid segment");
  });

  test("allows dots, underscores, and dashes in each segment", () => {
    expect(parseSessionName("my.org/my_project/fix-bug.1")).toEqual({
      categoryPath: "my.org",
      slug: "my_project/fix-bug.1",
    });
  });
});
