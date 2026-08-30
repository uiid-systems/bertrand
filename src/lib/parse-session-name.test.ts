import { describe, test, expect } from "bun:test";
import { parseSessionName } from "./parse-session-name";

describe("parseSessionName", () => {
  test("single segment is a valid flat slug", () => {
    expect(parseSessionName("my-session")).toEqual({ slug: "my-session" });
  });

  test("multi-segment names keep their slashes in the slug", () => {
    expect(parseSessionName("REV-367/fe-determination")).toEqual({
      slug: "REV-367/fe-determination",
    });
  });

  test("deep nesting is one slug", () => {
    expect(parseSessionName("a/b/c/d/my-session")).toEqual({
      slug: "a/b/c/d/my-session",
    });
  });

  test("trims leading/trailing slashes", () => {
    expect(parseSessionName("/project/session/")).toEqual({
      slug: "project/session",
    });
  });

  test("trims whitespace", () => {
    expect(parseSessionName("  session  ")).toEqual({ slug: "session" });
  });

  test("collapses repeated slashes", () => {
    expect(parseSessionName("project//session")).toEqual({
      slug: "project/session",
    });
  });

  test("rejects empty input", () => {
    expect(() => parseSessionName("")).toThrow("cannot be empty");
    expect(() => parseSessionName("   ")).toThrow("cannot be empty");
    expect(() => parseSessionName("//")).toThrow("cannot be empty");
  });

  test("rejects invalid characters", () => {
    expect(() => parseSessionName("my session")).toThrow("Invalid segment");
    expect(() => parseSessionName("my@session")).toThrow("Invalid segment");
  });

  test("rejects segments starting with non-alphanumeric", () => {
    expect(() => parseSessionName("-session")).toThrow("Invalid segment");
    expect(() => parseSessionName(".hidden/session")).toThrow("Invalid segment");
  });

  test("validates every segment in a deep slug", () => {
    expect(() => parseSessionName("REV-367/bad segment")).toThrow("Invalid segment");
  });

  test("allows dots, underscores, and dashes in each segment", () => {
    expect(parseSessionName("my.org/my_project/fix-bug.1")).toEqual({
      slug: "my.org/my_project/fix-bug.1",
    });
  });
});
