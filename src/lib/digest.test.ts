import { describe, test, expect } from "bun:test";
import { segmentByConversation, digestConversation, digestSession } from "./digest";
import type { EventRow } from "@/types";

let nextId = 1;

function ev(
  event: string,
  opts?: {
    conversationId?: string | null;
    createdAt?: string;
    summary?: string;
    meta?: Record<string, unknown> | null;
  },
): EventRow {
  return {
    id: nextId++,
    sessionId: "s1",
    conversationId: opts?.conversationId ?? null,
    event,
    summary: opts?.summary ?? null,
    meta: opts?.meta ?? null,
    createdAt: opts?.createdAt ?? "2026-07-10 12:00:00",
  } as EventRow;
}

describe("segmentByConversation", () => {
  test("groups events by conversationId with ordinals", () => {
    const events = [
      ev("claude.started", { conversationId: "aaaa-1111" }),
      ev("user.prompt", { conversationId: "aaaa-1111" }),
      ev("claude.started", { conversationId: "bbbb-2222" }),
      ev("user.prompt", { conversationId: "bbbb-2222" }),
    ];
    const segments = segmentByConversation(events);
    expect(segments.length).toBe(2);
    expect(segments[0]!.ordinal).toBe(1);
    expect(segments[0]!.conversationId).toBe("aaaa-1111");
    expect(segments[0]!.events.length).toBe(2);
    expect(segments[1]!.ordinal).toBe(2);
    expect(segments[1]!.conversationId).toBe("bbbb-2222");
  });

  test("legacy null conversationId rows carry forward into the current segment", () => {
    const events = [
      ev("claude.started", { conversationId: "aaaa-1111" }),
      ev("tool.used", { conversationId: null }),
      ev("user.prompt", { conversationId: "aaaa-1111" }),
    ];
    const segments = segmentByConversation(events);
    expect(segments.length).toBe(1);
    expect(segments[0]!.events.length).toBe(3);
  });

  test("leading null conversationId rows open an unknown segment", () => {
    const events = [
      ev("user.prompt", { conversationId: null }),
      ev("claude.started", { conversationId: "aaaa-1111" }),
    ];
    const segments = segmentByConversation(events);
    expect(segments.length).toBe(2);
    expect(segments[0]!.conversationId).toBe("unknown");
  });

  test("empty input produces no segments", () => {
    expect(segmentByConversation([])).toEqual([]);
  });
});

describe("digestConversation", () => {
  const cid = "a9750fd5-a95e-40f6-af1c-8195fcf8e582";

  test("extracts subject, prompts, decisions, files, and outcome", () => {
    const events = [
      ev("claude.started", {
        conversationId: cid,
        createdAt: "2026-07-10 10:00:00",
        meta: { cwd: "/repo" },
      }),
      ev("user.prompt", { conversationId: cid, meta: { prompt: "first prompt: the subject" } }),
      ev("assistant.message", { conversationId: cid, meta: { text: "working on it" } }),
      ev("session.waiting", { conversationId: cid, meta: { question: "A or B?" } }),
      ev("session.answered", { conversationId: cid, meta: { answers: { "A or B?": "B" } } }),
      ev("user.prompt", { conversationId: cid, meta: { prompt: "follow-up prompt" } }),
      ev("tool.applied", {
        conversationId: cid,
        meta: { permissions: [{ tool: "Edit", detail: "/repo/src/a.ts", outcome: "applied" }] },
      }),
      ev("tool.applied", {
        conversationId: cid,
        meta: {
          permissions: [
            { tool: "Write", detail: "/repo/src/b.ts", outcome: "applied" },
            { tool: "Edit", detail: "/repo/src/a.ts", outcome: "applied" },
          ],
        },
      }),
      ev("assistant.message", {
        conversationId: cid,
        createdAt: "2026-07-10 11:00:00",
        meta: { text: "done — shipped the fix" },
      }),
    ];

    const digest = digestConversation({ conversationId: cid, ordinal: 1, events });

    expect(digest.id).toBe("a9750fd5");
    expect(digest.subject).toBe("first prompt: the subject");
    expect(digest.prompts).toEqual(["follow-up prompt"]);
    expect(digest.decisions).toEqual([
      { q: "A or B?", a: "B", at: "2026-07-10 12:00:00" },
    ]);
    expect(digest.filesTouched).toEqual(["src/a.ts", "src/b.ts"]);
    expect(digest.outcome).toBe("done — shipped the fix");
    expect(digest.startedAt).toBe("2026-07-10 10:00:00");
    expect(digest.endedAt).toBe("2026-07-10 11:00:00");
    expect(digest.eventCount).toBe(9);
  });

  test("unanswered waiting becomes an open decision with a null answer", () => {
    const events = [
      ev("session.waiting", { conversationId: cid, meta: { question: "Ship it?" } }),
    ];
    const digest = digestConversation({ conversationId: cid, ordinal: 1, events });
    expect(digest.decisions).toEqual([
      { q: "Ship it?", a: null, at: "2026-07-10 12:00:00" },
    ]);
  });

  test("truncates long fields", () => {
    const long = "x".repeat(1000);
    const events = [
      ev("user.prompt", { conversationId: cid, meta: { prompt: long } }),
      ev("assistant.message", { conversationId: cid, meta: { text: long } }),
    ];
    const digest = digestConversation({ conversationId: cid, ordinal: 1, events });
    expect(digest.subject!.length).toBe(200);
    expect(digest.outcome!.length).toBe(300);
  });

  test("paths outside cwd stay absolute", () => {
    const events = [
      ev("claude.started", { conversationId: cid, meta: { cwd: "/repo" } }),
      ev("tool.applied", {
        conversationId: cid,
        meta: { permissions: [{ tool: "Edit", detail: "/elsewhere/x.ts", outcome: "applied" }] },
      }),
    ];
    const digest = digestConversation({ conversationId: cid, ordinal: 1, events });
    expect(digest.filesTouched).toEqual(["/elsewhere/x.ts"]);
  });

  test("empty conversation digests to nulls", () => {
    const digest = digestConversation({ conversationId: "unknown", ordinal: 1, events: [] });
    expect(digest.subject).toBeNull();
    expect(digest.outcome).toBeNull();
    expect(digest.decisions).toEqual([]);
    expect(digest.filesTouched).toEqual([]);
    expect(digest.id).toBe("unknown");
  });
});

describe("digestSession", () => {
  test("produces one digest per conversation in order", () => {
    const events = [
      ev("user.prompt", { conversationId: "aaaa-1111", meta: { prompt: "convo one" } }),
      ev("user.prompt", { conversationId: "bbbb-2222", meta: { prompt: "convo two" } }),
    ];
    const digests = digestSession(events);
    expect(digests.length).toBe(2);
    expect(digests[0]!.subject).toBe("convo one");
    expect(digests[1]!.subject).toBe("convo two");
    expect(digests[1]!.ordinal).toBe(2);
  });
});
