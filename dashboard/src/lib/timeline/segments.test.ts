import { describe, test, expect } from "bun:test";
import { segmentConversations } from "./segments";
import type { EventRow } from "../../api/types";

let seq = 0;
function ev(
  conversationId: string | null,
  event: string,
  meta: Record<string, unknown> | null = null,
): EventRow {
  seq += 1;
  return {
    id: seq,
    sessionId: "s1",
    conversationId,
    event,
    summary: null,
    meta,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
  } as EventRow;
}

describe("segmentConversations", () => {
  test("groups events by conversationId into ordered segments", () => {
    const events = [
      ev("aaaaaaaa-1", "claude.started"),
      ev("aaaaaaaa-1", "user.prompt", { prompt: "first goal" }),
      ev("bbbbbbbb-2", "claude.started"),
      ev("bbbbbbbb-2", "user.prompt", { prompt: "second goal" }),
    ];
    const segs = segmentConversations(events);

    expect(segs).toHaveLength(2);
    expect(segs.map((s) => s.ordinal)).toEqual([1, 2]);
    expect(segs[0].conversationId).toBe("aaaaaaaa-1");
    expect(segs[1].conversationId).toBe("bbbbbbbb-2");
  });

  test("anchor is derived from the conversation id prefix", () => {
    const segs = segmentConversations([ev("abcdef12-3456", "claude.started")]);
    // single-segment inputs still produce a segment (header shown conditionally)
    expect(segs[0].anchorId).toBe("conversation-abcdef12");
  });

  test("title is the first user prompt, truncated", () => {
    const long = "x".repeat(200);
    const segs = segmentConversations([
      ev("c-1", "claude.started"),
      ev("c-1", "user.prompt", { prompt: `  spaced   prompt  ` }),
      ev("c-1", "user.prompt", { prompt: "later prompt ignored" }),
      ev("c-2", "user.prompt", { prompt: long }),
    ]);
    expect(segs[0].title).toBe("spaced prompt");
    expect(segs[1].title!.endsWith("…")).toBe(true);
    expect(segs[1].title!.length).toBeLessThanOrEqual(80);
  });

  test("title is null when a conversation has no user prompt", () => {
    const segs = segmentConversations([ev("c-1", "claude.started")]);
    expect(segs[0].title).toBeNull();
  });

  test("legacy null-conversationId rows carry forward into the current segment", () => {
    const segs = segmentConversations([
      ev("c-1", "claude.started"),
      ev(null, "tool.used", { tool: "Read" }),
      ev("c-1", "user.prompt", { prompt: "hi" }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].conversationId).toBe("c-1");
  });

  test("leading null rows open an 'unknown' segment", () => {
    const segs = segmentConversations([
      ev(null, "tool.used", { tool: "Read" }),
      ev("c-1", "claude.started"),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].conversationId).toBe("unknown");
    expect(segs[0].anchorId).toBe("conversation-unknown");
  });

  test("empty input yields no segments", () => {
    expect(segmentConversations([])).toEqual([]);
  });
});
