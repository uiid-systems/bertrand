import { describe, test, expect } from "bun:test";
import {
  repairQAPairs,
  collapsePermissions,
  deduplicate,
  filterSkipped,
  compact,
} from "./compact.ts";
import type { EnrichedEvent } from "./catalog.ts";

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
      ev("session.block", t(0), { claudeId: "c1" }),
      ev("session.resume", t(1), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual(["session.block", "session.resume"]);
  });

  test("relocates resume to be adjacent to block", () => {
    const events = [
      ev("session.block", t(0), { claudeId: "c1" }),
      ev("permission.request", t(1)),
      ev("permission.resolve", t(2)),
      ev("session.resume", t(3), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual([
      "session.block",
      "session.resume",
      "permission.request",
      "permission.resolve",
    ]);
  });

  test("no matching block — resume stays in place", () => {
    const events = [
      ev("permission.request", t(0)),
      ev("session.resume", t(1), { claudeId: "c1" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual(["permission.request", "session.resume"]);
  });

  test("mismatched claudeId — no relocation", () => {
    const events = [
      ev("session.block", t(0), { claudeId: "c1" }),
      ev("permission.request", t(1)),
      ev("session.resume", t(2), { claudeId: "c2" }),
    ];
    const result = repairQAPairs(events);
    expect(result.map((e) => e.event)).toEqual([
      "session.block",
      "permission.request",
      "session.resume",
    ]);
  });
});

describe("collapsePermissions", () => {
  test("single permission with detail", () => {
    const events = [
      ev("permission.request", t(0), { meta: { tool: "Bash", detail: "git status" } }),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.event).toBe("tool.work");
    expect(result[0]!.summary).toBe("ran `git status`");
  });

  test("multiple permissions collapsed with counts", () => {
    const events = [
      ev("permission.request", t(0), { meta: { tool: "Bash" } }),
      ev("permission.resolve", t(1), { meta: { tool: "Bash" } }),
      ev("permission.request", t(2), { meta: { tool: "Edit" } }),
      ev("permission.resolve", t(3), { meta: { tool: "Edit" } }),
      ev("permission.request", t(4), { meta: { tool: "Bash" } }),
      ev("permission.resolve", t(5), { meta: { tool: "Bash" } }),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.event).toBe("tool.work");
    expect(result[0]!.summary).toBe("2× Bash, 1× Edit");
  });

  test("non-permission events pass through", () => {
    const events = [
      ev("claude.started", t(0)),
      ev("permission.request", t(1), { meta: { tool: "Bash" } }),
      ev("permission.resolve", t(2), { meta: { tool: "Bash" } }),
      ev("session.block", t(3)),
    ];
    const result = collapsePermissions(events);
    expect(result).toHaveLength(3);
    expect(result[0]!.event).toBe("claude.started");
    expect(result[1]!.event).toBe("tool.work");
    expect(result[2]!.event).toBe("session.block");
  });

  test("empty list", () => {
    expect(collapsePermissions([])).toEqual([]);
  });
});

describe("deduplicate", () => {
  test("collapses consecutive identical events", () => {
    const events = [
      ev("session.block", t(0), { summary: "q?" }),
      ev("session.block", t(1), { summary: "q?" }),
      ev("session.block", t(2), { summary: "q?" }),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(1);
    expect(result[0]!.createdAt).toBe(t(2)); // keeps latest
  });

  test("different summaries are not collapsed", () => {
    const events = [
      ev("session.block", t(0), { summary: "q1?" }),
      ev("session.block", t(1), { summary: "q2?" }),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(2);
  });

  test("different event types are not collapsed", () => {
    const events = [
      ev("session.block", t(0)),
      ev("session.resume", t(1)),
    ];
    const result = deduplicate(events);
    expect(result).toHaveLength(2);
  });

  test("empty list", () => {
    expect(deduplicate([])).toEqual([]);
  });
});

describe("filterSkipped", () => {
  test("removes context.snapshot events", () => {
    const events = [
      ev("claude.started", t(0)),
      ev("context.snapshot", t(1)),
      ev("claude.ended", t(2)),
    ];
    const result = filterSkipped(events);
    expect(result.map((e) => e.event)).toEqual(["claude.started", "claude.ended"]);
  });
});

describe("compact (pipeline)", () => {
  test("realistic event sequence", () => {
    const events = [
      ev("claude.started", t(0), { claudeId: "c1" }),
      ev("permission.request", t(1), { meta: { tool: "Bash", detail: "npm test" } }),
      ev("permission.resolve", t(2), { meta: { tool: "Bash" } }),
      ev("context.snapshot", t(3)),
      ev("session.block", t(4), { claudeId: "c1", summary: "Which file?" }),
      ev("permission.request", t(5), { meta: { tool: "Read" } }),
      ev("session.resume", t(6), { claudeId: "c1", summary: "src/index.ts" }),
      ev("claude.ended", t(7), { claudeId: "c1" }),
    ];
    const result = compact(events);

    // context.snapshot filtered
    // permissions collapsed
    // Q&A paired (resume moves after block)
    const eventTypes = result.map((e) => e.event);
    expect(eventTypes).toContain("claude.started");
    expect(eventTypes).toContain("tool.work");
    expect(eventTypes).toContain("session.block");
    expect(eventTypes).toContain("session.resume");
    expect(eventTypes).toContain("claude.ended");
    expect(eventTypes).not.toContain("context.snapshot");
    expect(eventTypes).not.toContain("permission.request");

    // Block and resume should be adjacent
    const blockIdx = result.findIndex((e) => e.event === "session.block");
    const resumeIdx = result.findIndex((e) => e.event === "session.resume");
    expect(resumeIdx).toBe(blockIdx + 1);
  });

  test("empty list", () => {
    expect(compact([])).toEqual([]);
  });
});
