import { describe, test, expect } from "bun:test";
import { consolidateAgentTurns } from "./transforms";
import type { EventRow } from "../../api/types";

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

describe("consolidateAgentTurns", () => {
  test("folds a run of prose + tool work into one agent.turn card", () => {
    const msg1 = ev("assistant.message", { text: "planning" });
    const work = ev("tool.work", { permissions: [] });
    const applied = ev("tool.applied", { permissions: [] });
    const msg2 = ev("assistant.message", { text: "done" });

    const out = consolidateAgentTurns([
      ev("user.prompt", { prompt: "go" }),
      msg1,
      work,
      applied,
      msg2,
      ev("session.answered", { answers: {} }),
    ]);

    expect(out.map((e) => e.event)).toEqual([
      "user.prompt",
      "agent.turn",
      "session.answered",
    ]);
    const turn = out[1];
    expect(turn.id).toBe(msg1.id); // first member's id → stable anchor
    expect(turn.createdAt).toBe(msg1.createdAt); // turn started when it began
    expect((turn.meta?.parts as EventRow[]).map((p) => p.event)).toEqual([
      "assistant.message",
      "tool.work",
      "tool.applied",
      "assistant.message",
    ]);
  });

  test("leaves a lone agent event untouched", () => {
    const only = ev("assistant.message", { text: "hi" });
    const out = consolidateAgentTurns([
      ev("user.prompt", { prompt: "go" }),
      only,
      ev("user.prompt", { prompt: "again" }),
    ]);
    expect(out.map((e) => e.event)).toEqual([
      "user.prompt",
      "assistant.message",
      "user.prompt",
    ]);
    expect(out[1]).toBe(only);
  });

  test("human and lifecycle events break the run into separate turns", () => {
    const out = consolidateAgentTurns([
      ev("assistant.message", { text: "a" }),
      ev("tool.work", { permissions: [] }),
      ev("user.prompt", { prompt: "interject" }),
      ev("assistant.message", { text: "b" }),
      ev("tool.applied", { permissions: [] }),
      ev("claude.ended"),
    ]);
    expect(out.map((e) => e.event)).toEqual([
      "agent.turn",
      "user.prompt",
      "agent.turn",
      "claude.ended",
    ]);
  });
});
