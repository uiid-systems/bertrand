import { describe, test, expect } from "bun:test";
import type { SessionListRow, SessionStatus } from "@/types";
import {
  countByStatus,
  isLiveStatus,
  recencyMs,
  visibleLaunchSessions,
} from "./launch.utils";

function row(
  slug: string,
  status: SessionStatus,
  times: { startedAt?: string; endedAt?: string | null; updatedAt?: string } = {},
): SessionListRow {
  return {
    session: {
      id: `id-${slug}`,
      slug,
      nameSource: "manual",
      status,
      summary: null,
      pid: null,
      pidStartedAt: null,
      startedAt: times.startedAt ?? "2026-09-01 10:00:00",
      endedAt: times.endedAt ?? null,
      branch: null,
      worktreeRoot: null,
      mainCheckout: null,
      repo: null,
      groupKey: null,
      createdAt: times.startedAt ?? "2026-09-01 10:00:00",
      updatedAt: times.updatedAt ?? "2026-09-01 10:00:00",
    } as SessionListRow["session"],
  };
}

const slugs = (rows: SessionListRow[]) => rows.map((r) => r.session.slug);

describe("isLiveStatus", () => {
  test("active, waiting and blocked are live; paused and archived are not", () => {
    expect(isLiveStatus("active")).toBe(true);
    expect(isLiveStatus("waiting")).toBe(true);
    expect(isLiveStatus("blocked")).toBe(true);
    expect(isLiveStatus("paused")).toBe(false);
    expect(isLiveStatus("archived")).toBe(false);
  });
});

describe("visibleLaunchSessions", () => {
  test("a session that is still running is listed, not hidden until it finishes", () => {
    const rows = [row("done", "paused"), row("running", "active")];
    expect(slugs(visibleLaunchSessions(rows, false))).toEqual(["running", "done"]);
  });

  test("blocked sessions are listed too", () => {
    const rows = [row("approve-me", "blocked")];
    expect(slugs(visibleLaunchSessions(rows, false))).toEqual(["approve-me"]);
  });

  test("archived rows are hidden unless toggled on", () => {
    const rows = [row("old", "archived"), row("p", "paused")];
    expect(slugs(visibleLaunchSessions(rows, false))).toEqual(["p"]);
    expect(slugs(visibleLaunchSessions(rows, true))).toEqual(["p", "old"]);
  });

  test("orders live rows first (blocked, waiting, active), then paused, then archived", () => {
    const rows = [
      row("p", "paused"),
      row("a", "active"),
      row("z", "archived"),
      row("w", "waiting"),
      row("b", "blocked"),
    ];
    expect(slugs(visibleLaunchSessions(rows, true))).toEqual([
      "b",
      "w",
      "a",
      "p",
      "z",
    ]);
  });

  test("within a status, most recent activity comes first", () => {
    const rows = [
      row("older", "paused", { endedAt: "2026-09-01 09:00:00" }),
      row("newer", "paused", { endedAt: "2026-09-01 11:00:00" }),
    ];
    expect(slugs(visibleLaunchSessions(rows, false))).toEqual(["newer", "older"]);
  });

  test("does not mutate the input", () => {
    const rows = [row("b", "waiting"), row("a", "paused")];
    visibleLaunchSessions(rows, false);
    expect(slugs(rows)).toEqual(["b", "a"]);
  });
});

describe("recencyMs", () => {
  test("a live row reads updatedAt, since a resumed session's startedAt can be days old", () => {
    const live = row("live", "active", {
      startedAt: "2026-09-01 10:00:00",
      updatedAt: "2026-09-09 15:30:00",
    });
    expect(recencyMs(live)).toBe(Date.parse("2026-09-09T15:30:00Z"));
  });

  test("a paused row prefers endedAt over startedAt", () => {
    const paused = row("p", "paused", {
      startedAt: "2026-09-01 10:00:00",
      endedAt: "2026-09-02 10:00:00",
      updatedAt: "2026-09-09 15:30:00",
    });
    expect(recencyMs(paused)).toBe(Date.parse("2026-09-02T10:00:00Z"));
  });

  test("a paused row with no endedAt falls back to startedAt", () => {
    const paused = row("p", "paused", { startedAt: "2026-09-03 10:00:00" });
    expect(recencyMs(paused)).toBe(Date.parse("2026-09-03T10:00:00Z"));
  });
});

describe("countByStatus", () => {
  test("counts every status, zero-filling the missing ones", () => {
    const rows = [row("a", "active"), row("b", "active"), row("p", "paused")];
    expect(countByStatus(rows)).toEqual({
      active: 2,
      waiting: 0,
      blocked: 0,
      paused: 1,
      archived: 0,
    });
  });
});
