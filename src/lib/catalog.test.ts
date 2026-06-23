import { describe, test, expect } from "bun:test";
import { lookup, enrich, enrichAll, type EventType } from "./catalog";

const ALL_EVENT_TYPES: EventType[] = [
  "claude.started",
  "claude.ended",
  "claude.discarded",
  "session.waiting",
  "session.answered",
  "user.prompt",
  "session.recap",
  "worktree.entered",
  "worktree.exited",
];

function row(event: string, meta?: unknown) {
  return {
    id: 1,
    sessionId: "s1",
    conversationId: "c1",
    event,
    createdAt: "2026-04-12T10:00:00.000Z",
    summary: null,
    meta,
  };
}

describe("lookup", () => {
  test("all known event types have catalog entries", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      const info = lookup(eventType);
      expect(info.label).not.toBe("unknown");
      expect(info.category).toBeTruthy();
      expect(typeof info.color).toBe("number");
      expect(typeof info.skip).toBe("boolean");
    }
  });

  test("unknown event type returns default", () => {
    const info = lookup("some.unknown.event");
    expect(info.label).toBe("unknown");
    expect(info.category).toBe("lifecycle");
    expect(info.skip).toBe(false);
  });

  test("categories are correct", () => {
    expect(lookup("claude.started").category).toBe("lifecycle");
    expect(lookup("session.waiting").category).toBe("interaction");
  });
});

describe("enrich", () => {
  test("attaches label and category from catalog", () => {
    const enriched = enrich(row("claude.started"));
    expect(enriched.label).toBe("claude started");
    expect(enriched.category).toBe("lifecycle");
  });

  test("extracts claudeId from conversationId", () => {
    const enriched = enrich(row("claude.started"));
    expect(enriched.claudeId).toBe("c1");
  });

  test("extracts claudeId from meta fallback", () => {
    const r = { ...row("claude.started"), conversationId: null };
    r.meta = { claude_id: "meta-id" };
    const enriched = enrich(r);
    expect(enriched.claudeId).toBe("meta-id");
  });

  test("extracts summary from session.waiting question", () => {
    const enriched = enrich(row("session.waiting", { question: "What file?" }));
    expect(enriched.summary).toBe("What file?");
  });

  test("extracts summary from session.answered answers", () => {
    const enriched = enrich(
      row("session.answered", { answers: { "Which file?": "src/index.ts" } }),
    );
    expect(enriched.summary).toBe("src/index.ts");
  });

  test("joins multiple session.answered answers", () => {
    const enriched = enrich(
      row("session.answered", { answers: { Q1: "yes", Q2: "no" } }),
    );
    expect(enriched.summary).toBe("yes, no");
  });

  test("extracts recap text from session.recap", () => {
    const enriched = enrich(row("session.recap", { recap: "Shipped the timeline content" }));
    expect(enriched.summary).toBe("Shipped the timeline content");
  });

  test("extracts branch from worktree.entered", () => {
    const enriched = enrich(
      row("worktree.entered", {
        branch: "worktree-feat",
        path: "/repo/.claude/worktrees/feat",
      }),
    );
    expect(enriched.label).toBe("worktree entered");
    expect(enriched.summary).toBe("worktree-feat");
  });

  test("no meta returns empty summary", () => {
    const enriched = enrich(row("claude.started"));
    expect(enriched.summary).toBe("");
  });

  test("uses row.summary when present", () => {
    const r = { ...row("claude.started"), summary: "custom summary" };
    const enriched = enrich(r);
    expect(enriched.summary).toBe("custom summary");
  });

  test("unknown event gets default enrichment", () => {
    const enriched = enrich(row("unknown.event"));
    expect(enriched.label).toBe("unknown");
    expect(enriched.summary).toBe("");
  });
});

describe("enrichAll", () => {
  test("enriches multiple events", () => {
    const rows = [row("claude.started"), row("session.waiting", { question: "q?" })];
    const enriched = enrichAll(rows);
    expect(enriched).toHaveLength(2);
    expect(enriched[0]!.label).toBe("claude started");
    expect(enriched[1]!.summary).toBe("q?");
  });

  test("empty array returns empty", () => {
    expect(enrichAll([])).toEqual([]);
  });
});
