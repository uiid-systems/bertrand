import { describe, test, expect } from "bun:test";
import { shouldIgnoreStatusFlip } from "./update";

describe("shouldIgnoreStatusFlip (delayed-hook race guard)", () => {
  test("ignores 'active' flip when pid is null (post-finalize state)", () => {
    expect(shouldIgnoreStatusFlip("active", null)).toBe(true);
  });

  test("ignores 'waiting' flip when pid is null", () => {
    expect(shouldIgnoreStatusFlip("waiting", null)).toBe(true);
  });

  test("allows 'paused' flip when pid is null (legitimate finalize)", () => {
    expect(shouldIgnoreStatusFlip("paused", null)).toBe(false);
  });

  test("allows 'active' flip when pid is set (live session)", () => {
    expect(shouldIgnoreStatusFlip("active", 12345)).toBe(false);
  });

  test("allows 'waiting' flip when pid is set", () => {
    expect(shouldIgnoreStatusFlip("waiting", 12345)).toBe(false);
  });

  test("allows 'archived' flip when pid is null", () => {
    expect(shouldIgnoreStatusFlip("archived", null)).toBe(false);
  });

  test("returns false when newStatus is undefined (no transition implied)", () => {
    expect(shouldIgnoreStatusFlip(undefined, null)).toBe(false);
    expect(shouldIgnoreStatusFlip(undefined, 12345)).toBe(false);
  });
});
