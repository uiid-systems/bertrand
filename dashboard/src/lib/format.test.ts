import { describe, test, expect } from "bun:test";
import { summarizeAgentTurn } from "./format";
import type { EventRow } from "../api/types";

let seq = 0;
function ev(
  event: string,
  meta: Record<string, unknown> | null = null,
): EventRow {
  seq += 1;
  return {
    id: seq,
    sessionId: "s1",
    conversationId: "c1",
    event,
    summary: null,
    meta,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
  } as EventRow;
}

function turn(parts: EventRow[]): EventRow {
  return ev("agent.turn", { parts });
}

describe("summarizeAgentTurn", () => {
  test("returns null for non-turn events", () => {
    expect(summarizeAgentTurn(ev("assistant.message", { text: "hi" }))).toBeNull();
  });

  test("returns null for a prose-only turn (no tool work)", () => {
    expect(
      summarizeAgentTurn(
        turn([
          ev("assistant.message", { text: "a" }),
          ev("assistant.message", { text: "b" }),
        ]),
      ),
    ).toBeNull();
  });

  test("counts total tool calls with a reads breakdown", () => {
    const t = turn([
      ev("assistant.message", { text: "looking" }),
      ev("tool.work", {
        permissions: [
          { tool: "Read", detail: "a.ts", count: 3 },
          { tool: "Bash", detail: "ls", count: 2 },
        ],
      }),
    ]);
    // 5 tools total (3 reads + 2 bash), 3 of them reads
    expect(summarizeAgentTurn(t)).toBe("5 tools · 3 reads");
  });

  test("adds a file-diff segment with +/- line counts", () => {
    const t = turn([
      ev("tool.applied", {
        permissions: [
          {
            tool: "Edit",
            detail: "src/foo.ts",
            count: 1,
            edits: [{ oldStr: "one\ntwo", newStr: "one\ntwo\nthree" }],
          },
        ],
      }),
    ]);
    // 1 tool, 1 file, oldStr=2 lines removed, newStr=3 lines added
    expect(summarizeAgentTurn(t)).toBe("1 tool · 1 file (+3 -2)");
  });

  test("dedupes files across parts and sums the whole turn", () => {
    const t = turn([
      ev("tool.work", { permissions: [{ tool: "Read", detail: "a.ts", count: 4 }] }),
      ev("tool.applied", {
        permissions: [
          { tool: "Edit", detail: "b.ts", count: 1, oldStr: "x", newStr: "y" },
          { tool: "Write", detail: "c.ts", count: 1, newStr: "new\nfile" },
        ],
      }),
    ]);
    // 6 tools (4 reads + 2 edits), 4 reads, 2 files, added=1+2=3, removed=1
    expect(summarizeAgentTurn(t)).toBe("6 tools · 4 reads · 2 files (+3 -1)");
  });
});
