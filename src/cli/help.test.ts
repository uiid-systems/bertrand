import { describe, expect, test } from "bun:test";
import { helpText } from "@/cli/help";

describe("helpText", () => {
  test("human variant omits the session-context framing", () => {
    const text = helpText();
    expect(text).not.toContain("running inside a bertrand session");
    expect(text).toStartWith("bertrand — multi-session workflow manager");
  });

  test("agent variant adds the session-context framing", () => {
    const text = helpText({ agent: true });
    expect(text).toContain("running inside a bertrand session");
    expect(text).toContain("instead of assuming sessions are isolated");
  });

  test("both variants share the command reference body", () => {
    for (const text of [helpText(), helpText({ agent: true })]) {
      expect(text).toContain("bertrand log <session>");
      expect(text).toContain("bertrand list");
      expect(text).toContain("bertrand sync <op>");
    }
  });

  test("neither variant advertises a project surface", () => {
    // The reference is also what the session-start contract injects, so a
    // stale line here teaches every agent a command that no longer exists.
    for (const text of [helpText(), helpText({ agent: true })]) {
      expect(text).not.toContain("bertrand project");
      expect(text).not.toContain("--project");
      expect(text).not.toContain("--all-projects");
    }
  });
});
