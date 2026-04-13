import { describe, test, expect } from "bun:test";
import { formatDuration, formatAgo, truncate, formatTime } from "./format";

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
    expect(formatAgo(new Date())).toBe("just now");
  });

  test("minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    expect(formatAgo(fiveMinAgo)).toBe("5m ago");
  });

  test("hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000);
    expect(formatAgo(threeHoursAgo)).toBe("3h ago");
  });

  test("accepts ISO string", () => {
    const recent = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(formatAgo(recent)).toBe("10m ago");
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
