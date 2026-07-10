import { describe, test, expect } from "bun:test";
import {
  repairQAPairs,
  collapsePermissions,
  deduplicate,
  filterSkipped,
  compact,
} from "./compact";
import type { EnrichedEvent } from "./catalog";

function ev(
  event: string,
  createdAt: string,
  opts?: { claudeId?: string; summary?: string; meta?: unknown }
): EnrichedEvent {
  return {
    sessionId: "s1",
    event,
    createdAt,
    label: event,
    category: "lifecycle",
    color: 0,
    detailColor: 0,
    summary: opts?.summary ?? "",
    claudeId: opts?.claudeId ?? "c1",
    meta: opts?.meta,
  };
}

function t(minutes: number): string {
  return new Date(Date.UTC(2026, 3, 12, 10, minutes, 0)).toISOString();
}

describe("repairQAPairs", () => {
  test("already adjacent — no change", () => {
    const events = [
      ev("session.waiting", t(0), { claudeId: "c1" }),
      ev("session.answered", t(1), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual(["session.waiting", "session.answered"]);
  });

  test("relocates resume to be adjacent to block", () => {
    const events = [
      ev("session.waiting", t(0), { claudeId: "c1" }),
      ev("tool.used", t(1)),
      ev("tool.used", t(2)),
      ev("session.answered", t(3), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual([
      "session.waiting",
      "session.answered",
      "tool.used",
      "tool.used",
    ]);
  });

  test("no matching block — resume stays in place", () => {
    const events = [
      ev("tool.used", t(0)),
      ev("session.answered", t(1), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual(["tool.used", "session.answered"]);
  });

  test("mismatched claudeId — no relocation", () => {
    const events = [
      ev("session.waiting", t(0), { claudeId: "c1" }),
      ev("tool.used", t(1)),
      ev("session.answered", t(2), { claudeId: "c2" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual([
      "session.waiting",
      "tool.used",
      "session.answered",
    ]);
  });
});

describe("collapsePermissions", () => {
  test("single tool.used with detail", () => {
    const events = [
      ev("tool.used", t(0), { meta: { tool: "Bash", detail: "git status", outcome: "auto" } }),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.event).toBe("tool.work");
    expect(result[0]!.summary).toBe("ran `git status`");
  });

  test("multiple tool.used events collapsed with counts", () => {
    const events = [
      ev("tool.used", t(0), { meta: { tool: "Bash", outcome: "approved" } }),
      ev("tool.used", t(1), { meta: { tool: "Edit", outcome: "approved" } }),
      ev("tool.used", t(2), { meta: { tool: "Bash", outcome: "approved" } }),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.event).toBe("tool.work");
    expect(result[0]!.summary).toBe("2× Bash, 1× Edit");
  });

  test("non-tool events pass through", () => {
    const events = [
      ev("claude.started", t(0)),
      ev("tool.used", t(1), { meta: { tool: "Bash", outcome: "approved" } }),
      ev("session.waiting", t(2)),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(3);
    expect(result[0]!.event).toBe("claude.started");
    expect(result[1]!.event).toBe("tool.work");
    expect(result[2]!.event).toBe("session.waiting");
  });

  test("empty list", () => {
    expect(collapsePermissions([])).toEqual([]);
  });

  test("tool.used rolls up into tool.work", () => {
    const events = [
      ev("tool.used", t(0), { meta: { tool: "Read", outcome: "auto" } }),
      ev("tool.used", t(1), { meta: { tool: "Read", outcome: "auto" } }),
      ev("tool.used", t(2), { meta: { tool: "Read", outcome: "auto" } }),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.event).toBe("tool.work");
    expect(result[0]!.summary).toBe("3× Read");
  });
});

describe("collapsePermissions timestamp handling", () => {
  test("tool.work midpoint treats sqlite-format timestamps as UTC", () => {
    // "YYYY-MM-DD HH:MM:SS" strings from datetime('now') are UTC; a local
    // parse would shift the synthetic timestamp by the machine's UTC offset.
    const events = [
      ev("tool.used", "2026-04-12 10:00:00", { meta: { tool: "Bash" } }),
      ev("tool.used", "2026-04-12 10:00:10", { meta: { tool: "Bash" } }),
    ];
    const result = collapsePermissions(events);
    expect(result.length).toBe(1);
    expect(result[0]!.createdAt).toBe("2026-04-12T10:00:05.000Z");
  });
});

describe("deduplicate", () => {
  test("collapses consecutive identical events", () => {
    const events = [
      ev("session.waiting", t(0), { summary: "q?" }),
      ev("session.waiting", t(1), { summary: "q?" }),
      ev("session.waiting", t(2), { summary: "q?" }),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.createdAt).toBe(t(2)); // keeps latest
  });

  test("different summaries are not collapsed", () => {
    const events = [
      ev("session.waiting", t(0), { summary: "q1?" }),
      ev("session.waiting", t(1), { summary: "q2?" }),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(2);
  });

  test("different event types are not collapsed", () => {
    const events = [
      ev("session.waiting", t(0)),
      ev("session.answered", t(1)),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(2);
  });

  test("empty list", () => {
    expect(deduplicate([])).toEqual([]);
  });
});

describe("filterSkipped", () => {
  test("passes through when no events are marked skip", () => {
    const events = [
      ev("claude.started", t(0)),
      ev("session.waiting", t(1)),
      ev("claude.ended", t(2)),
    ];
    const result = filterSkipped(events);
    expect(result.map((e) => e.event)).toEqual(["claude.started", "session.waiting", "claude.ended"]);
  });
});

describe("compact (pipeline)", () => {
  test("realistic event sequence", () => {
    const events = [
      ev("claude.started", t(0), { claudeId: "c1" }),
      ev("tool.used", t(1), { meta: { tool: "Bash", detail: "npm test", outcome: "approved" } }),
      ev("session.waiting", t(2), { claudeId: "c1", summary: "Which file?" }),
      ev("tool.used", t(3), { meta: { tool: "Read", outcome: "auto" } }),
      ev("session.answered", t(4), { claudeId: "c1", summary: "src/index.ts" }),
      ev("claude.ended", t(5), { claudeId: "c1" }),
    ];
    const result = compact(events);

    // tool.used rolls into tool.work, Q&A paired
    const eventTypes = result.map((e) => e.event);
    expect(eventTypes).toContain("claude.started");
    expect(eventTypes).toContain("tool.work");
    expect(eventTypes).toContain("session.waiting");
    expect(eventTypes).toContain("session.answered");
    expect(eventTypes).toContain("claude.ended");
    expect(eventTypes).not.toContain("tool.used");

    // Block and resume should be adjacent
    const blockIdx = result.findIndex((e) => e.event === "session.waiting");
    const resumeIdx = result.findIndex((e) => e.event === "session.answered");
    expect(resumeIdx).toBe(blockIdx + 1);
  });

  test("empty list", () => {
    expect(compact([])).toEqual([]);
  });
});
