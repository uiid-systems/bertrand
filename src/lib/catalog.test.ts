import { describe, test, expect } from "bun:test";
import { lookup, enrich, enrichAll, type EventType } from "./catalog";

const ALL_EVENT_TYPES: EventType[] = [
  "session.started",
  "session.resumed",
  "session.end",
  "claude.started",
  "claude.ended",
  "claude.discarded",
  "session.waiting",
  "session.answered",
  "permission.request",
  "permission.resolve",
  "worktree.entered",
  "worktree.exited",
  "gh.pr.created",
  "gh.pr.merged",
  "linear.issue.read",
  "notion.page.read",
  "vercel.deploy",
  "user.prompt",
  "context.snapshot",
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

  test("context.snapshot is skip=true", () => {
    expect(lookup("context.snapshot").skip).toBe(true);
  });

  test("categories are correct", () => {
    expect(lookup("session.started").category).toBe("lifecycle");
    expect(lookup("session.waiting").category).toBe("interaction");
    expect(lookup("permission.request").category).toBe("work");
    expect(lookup("gh.pr.created").category).toBe("integration");
    expect(lookup("context.snapshot").category).toBe("context");
  });
});

describe("enrich", () => {
  test("attaches label and category from catalog", () => {
    const enriched = enrich(row("session.started"));
    expect(enriched.label).toBe("started");
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

  test("extracts summary from session.answered answer", () => {
    const enriched = enrich(row("session.answered", { answer: "src/index.ts" }));
    expect(enriched.summary).toBe("src/index.ts");
  });

  test("extracts summary from permission events", () => {
    const enriched = enrich(row("permission.request", { tool: "Bash", detail: "git status" }));
    expect(enriched.summary).toBe("Bash: git status");
  });

  test("permission without detail shows tool only", () => {
    const enriched = enrich(row("permission.request", { tool: "Edit" }));
    expect(enriched.summary).toBe("Edit");
  });

  test("extracts PR title from gh.pr.created", () => {
    const enriched = enrich(row("gh.pr.created", { pr_title: "Fix auth bug" }));
    expect(enriched.summary).toBe("Fix auth bug");
  });

  test("extracts branch from worktree.entered", () => {
    const enriched = enrich(row("worktree.entered", { branch: "feature/x" }));
    expect(enriched.summary).toBe("feature/x");
  });

  test("extracts context remaining pct", () => {
    const enriched = enrich(row("context.snapshot", { remaining_pct: "45" }));
    expect(enriched.summary).toBe("45% remaining");
  });

  test("no meta returns empty summary", () => {
    const enriched = enrich(row("session.started"));
    expect(enriched.summary).toBe("");
  });

  test("uses row.summary when present", () => {
    const r = { ...row("session.started"), summary: "custom summary" };
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
    const rows = [row("session.started"), row("claude.started"), row("session.waiting", { question: "q?" })];
    const enriched = enrichAll(rows);
    expect(enriched).toHaveLength(3);
    expect(enriched[0].label).toBe("started");
    expect(enriched[1].label).toBe("claude started");
    expect(enriched[2].summary).toBe("q?");
  });

  test("empty array returns empty", () => {
    expect(enrichAll([])).toEqual([]);
  });
});
