import { describe, test, expect } from "bun:test";
import {
  formatDuration,
  formatAgo,
  truncate,
  formatTime,
  parseDbTime,
  formatDbTime,
} from "./format";

describe("formatDuration", () => {
  test("seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(45000)).toBe("45s");
  });

  test("minutes", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(150_000)).toBe("2m");
  });

  test("hours and minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(5_580_000)).toBe("1h 33m");
  });

  test("days and hours", () => {
    expect(formatDuration(86_400_000)).toBe("1d");
    expect(formatDuration(90_000_000)).toBe("1d 1h");
  });
});

describe("formatAgo", () => {
  test("just now", () => {
    expect(formatAgo(new Date())).toBe("now");
  });

  test("minutes", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    expect(formatAgo(fiveMinAgo)).toBe("5m");
  });

  test("hours", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000);
    expect(formatAgo(threeHoursAgo)).toBe("3h");
  });

  test("accepts ISO string", () => {
    const recent = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatAgo(recent)).toBe("10m");
  });

  test("accepts the stored shape, which carries no zone", () => {
    // What `startedAt` and `updatedAt` actually hold. Read as local time this
    // is off by the machine's UTC offset — "10m" becomes "8h" west of it.
    const recent = formatDbTime(Date.now() - 10 * 60_000);
    expect(formatAgo(recent)).toBe("10m");
  });
});

describe("db timestamps", () => {
  test("reads the stored shape as UTC, not local", () => {
    expect(parseDbTime("2026-08-31 12:00:00")).toBe(
      Date.parse("2026-08-31T12:00:00Z"),
    );
  });

  test("reads ISO as-is", () => {
    expect(parseDbTime("2026-08-31T12:00:00.000Z")).toBe(
      Date.parse("2026-08-31T12:00:00Z"),
    );
  });

  test("formatDbTime is parseDbTime's inverse to the second", () => {
    const ms = Date.UTC(2026, 7, 31, 12, 0, 0);
    expect(formatDbTime(ms)).toBe("2026-08-31 12:00:00");
    expect(parseDbTime(formatDbTime(ms))).toBe(ms);
  });

  test("the two shapes of one instant subtract to zero", () => {
    // A session whose startedAt is a column default and whose endedAt was
    // written ISO before this release still has to measure a real duration.
    const ms = Date.UTC(2026, 7, 31, 12, 0, 0);
    expect(
      parseDbTime(new Date(ms).toISOString()) - parseDbTime(formatDbTime(ms)),
    ).toBe(0);
  });
});

describe("truncate", () => {
  test("short text unchanged", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  test("long text truncated with ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
  });

  test("exact length unchanged", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});

describe("formatTime", () => {
  test("time only", () => {
    const result = formatTime("2026-04-09T16:23:00.000Z");
    expect(result).toMatch(/\d{1,2}:\d{2}\s[AP]M/);
  });

  test("with date", () => {
    const result = formatTime("2026-04-09T16:23:00.000Z", true);
    expect(result).toMatch(/Apr\s+9/);
  });
});
