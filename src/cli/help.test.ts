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

  test("human variant keeps the full command reference", () => {
    const text = helpText();
    for (const cmd of ["bertrand log <session>", "bertrand list", "bertrand sync <op>", "bertrand adopt"]) {
      expect(text).toContain(cmd);
    }
  });

  test("agent variant is a compact subset of the human reference", () => {
    // Paid for in tokens on every conversation (docs/context-budget.md), so it
    // carries the read-only inspection commands and points at the rest.
    const agent = helpText({ agent: true });
    const human = helpText();
    expect(agent.length).toBeLessThan(human.length / 2);
    expect(agent).toContain("bertrand --help");
    // Drift guard: every command the agent is taught must exist in the full
    // reference, so trimming one side can't teach a command the CLI dropped.
    const taught = [...agent.matchAll(/^ {2}bertrand (\w+)/gm)].map((m) => m[1]);
    expect(taught).toEqual(["log", "search", "list", "stats"]);
    for (const cmd of taught) expect(human).toContain(`bertrand ${cmd}`);
    // Every flag the agent is taught must be one the full reference documents.
    for (const flag of new Set(agent.match(/--[a-z]+/g))) {
      if (flag !== "--help") expect(human).toContain(flag);
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
