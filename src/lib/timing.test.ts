import { describe, test, expect } from "bun:test";
import { computeTimings, type TimingSummary } from "./timing";

function ev(event: string, createdAt: string, conversationId?: string, meta?: unknown) {
  return { event, createdAt, conversationId: conversationId ?? null, meta };
}

function t(minutes: number): string {
  return new Date(Date.UTC(2026, 3, 12, 10, minutes, 0)).toISOString();
}

describe("computeTimings", () => {
  test("empty event list", () => {
    const result = computeTimings([]);
    expect(result.totalClaudeWorkMs).toBe(0);
    expect(result.totalUserWaitMs).toBe(0);
    expect(result.activePct).toBe(0);
    expect(result.durationS).toBe(0);
    expect(result.segments).toEqual([]);
  });

  test("single event", () => {
    const result = computeTimings([ev("claude.started", t(0))]);
    expect(result.segments).toEqual([]);
    expect(result.durationS).toBe(0);
  });

  test("simple work period: started → ended", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("claude.ended", t(5), "c1"),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("claude_work");
    expect(result.segments[0].durationMs).toBe(5 * 60_000);
    expect(result.totalClaudeWorkMs).toBe(5 * 60_000);
    expect(result.totalUserWaitMs).toBe(0);
    expect(result.activePct).toBe(100);
    expect(result.durationS).toBe(300);
  });

  test("work → block → resume → ended", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(3), "c1"),
      ev("session.resume", t(5), "c1"),
      ev("claude.ended", t(10), "c1"),
    ]);
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 3 * 60_000 });
    expect(result.segments[1]).toMatchObject({ type: "user_wait", durationMs: 2 * 60_000 });
    expect(result.segments[2]).toMatchObject({ type: "claude_work", durationMs: 5 * 60_000 });
    expect(result.totalClaudeWorkMs).toBe(8 * 60_000);
    expect(result.totalUserWaitMs).toBe(2 * 60_000);
    expect(result.activePct).toBe(80);
  });

  test("multiple block/resume cycles", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(2), "c1"),
      ev("session.resume", t(3), "c1"),
      ev("session.block", t(6), "c1"),
      ev("session.resume", t(8), "c1"),
      ev("claude.ended", t(10), "c1"),
    ]);
    expect(result.segments).toHaveLength(5);
    // work(2) + wait(1) + work(3) + wait(2) + work(2) = 7 work + 3 wait
    expect(result.totalClaudeWorkMs).toBe(7 * 60_000);
    expect(result.totalUserWaitMs).toBe(3 * 60_000);
    expect(result.activePct).toBe(70);
  });

  test("multi-conversation session", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("claude.ended", t(5), "c1"),
      ev("claude.started", t(6), "c2"),
      ev("session.block", t(8), "c2"),
      ev("session.resume", t(10), "c2"),
      ev("claude.ended", t(12), "c2"),
    ]);
    expect(result.segments).toHaveLength(4);
    // c1: work(5) | c2: work(2) + wait(2) + work(2)
    expect(result.totalClaudeWorkMs).toBe(9 * 60_000);
    expect(result.totalUserWaitMs).toBe(2 * 60_000);
  });

  test("claude ended while user blocked closes wait period", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(3), "c1"),
      ev("claude.ended", t(5), "c1"),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 3 * 60_000 });
    expect(result.segments[1]).toMatchObject({ type: "user_wait", durationMs: 2 * 60_000 });
  });

  test("malformed: double claude.started closes previous work period", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("claude.started", t(3), "c2"),
      ev("claude.ended", t(5), "c2"),
    ]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 3 * 60_000 });
    expect(result.segments[1]).toMatchObject({ type: "claude_work", durationMs: 2 * 60_000 });
  });

  test("malformed: block without prior started is ignored", () => {
    const result = computeTimings([
      ev("session.block", t(0)),
      ev("session.resume", t(2)),
    ]);
    // block in idle → enters blocked state, but no work segment emitted
    // resume closes the wait period
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ type: "user_wait", durationMs: 2 * 60_000 });
  });

  test("zero-duration segments are discarded", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(0), "c1"), // same timestamp
      ev("session.resume", t(2), "c1"),
      ev("claude.ended", t(2), "c1"), // same timestamp
    ]);
    // work(0) discarded, wait(2) kept, work(0) discarded
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("user_wait");
  });

  test("extracts claudeId from conversationId", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "conv-abc"),
      ev("claude.ended", t(5), "conv-abc"),
    ]);
    expect(result.segments[0].claudeId).toBe("conv-abc");
  });

  test("extracts claudeId from meta.claude_id fallback", () => {
    const result = computeTimings([
      ev("claude.started", t(0), undefined, { claude_id: "meta-id" }),
      ev("claude.ended", t(5), undefined, { claude_id: "meta-id" }),
    ]);
    expect(result.segments[0].claudeId).toBe("meta-id");
  });

  test("open work period closed at end of stream (no claude.ended)", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(3), "c1"),
      ev("session.resume", t(5), "c1"),
    ]);
    // work(3) + wait(2) + work(0 — last event is resume, same ts as period start)
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 3 * 60_000 });
    expect(result.segments[1]).toMatchObject({ type: "user_wait", durationMs: 2 * 60_000 });
  });

  test("open blocked period closed at end of stream", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("session.block", t(3), "c1"),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 3 * 60_000 });
    // blocked period is zero-duration (last event = block event) so discarded
  });

  test("non-timing events are ignored", () => {
    const result = computeTimings([
      ev("claude.started", t(0), "c1"),
      ev("permission.request", t(1), "c1"),
      ev("permission.resolve", t(2), "c1"),
      ev("gh.pr.created", t(3), "c1"),
      ev("claude.ended", t(5), "c1"),
    ]);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]).toMatchObject({ type: "claude_work", durationMs: 5 * 60_000 });
  });
});
