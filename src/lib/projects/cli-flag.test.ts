import { describe, expect, test } from "bun:test";
import { extractProjectFlag } from "./cli-flag";

describe("extractProjectFlag", () => {
  test("returns undefined project and untouched args when flag absent", () => {
    const { project, rest } = extractProjectFlag(["foo", "--json"]);
    expect(project).toBeUndefined();
    expect(rest).toEqual(["foo", "--json"]);
  });

  test("extracts --project <value> space-separated form", () => {
    const { project, rest } = extractProjectFlag([
      "--project",
      "acme",
      "foo/bar",
    ]);
    expect(project).toBe("acme");
    expect(rest).toEqual(["foo/bar"]);
  });

  test("extracts --project=<value> equals form", () => {
    const { project, rest } = extractProjectFlag([
      "--project=acme",
      "foo/bar",
    ]);
    expect(project).toBe("acme");
    expect(rest).toEqual(["foo/bar"]);
  });

  test("preserves other flags and positionals around the project flag", () => {
    const { project, rest } = extractProjectFlag([
      "--json",
      "--project",
      "acme",
      "foo/bar",
      "--all",
    ]);
    expect(project).toBe("acme");
    expect(rest).toEqual(["--json", "foo/bar", "--all"]);
  });

  test("last --project wins when passed twice", () => {
    const { project, rest } = extractProjectFlag([
      "--project",
      "first",
      "--project=second",
    ]);
    expect(project).toBe("second");
    expect(rest).toEqual([]);
  });

  test("--project at the very end with no value returns undefined slug", () => {
    // Defense against `--project` with no following token. applyProjectFlag
    // is a no-op on undefined, so this is the same as not passing the flag.
    const { project, rest } = extractProjectFlag(["foo", "--project"]);
    expect(project).toBeUndefined();
    expect(rest).toEqual(["foo"]);
  });
});
