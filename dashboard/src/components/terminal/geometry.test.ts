import { describe, expect, test } from "bun:test";
import type { FitAddon } from "@xterm/addon-fit";

import { CLAIM_BOUNDS, clampDims, proposeDims, sameDims } from "./geometry";

function stubFit(
  proposed: { cols: number; rows: number } | undefined,
): FitAddon {
  return { proposeDimensions: () => proposed } as unknown as FitAddon;
}

describe("terminal geometry", () => {
  test("takes the grid the fit addon measured for the box", () => {
    // The font size is fixed, so a bigger box simply means more cells — this is
    // the whole sizing model.
    expect(proposeDims(stubFit({ cols: 124, rows: 38 }))).toEqual({
      cols: 124,
      rows: 38,
    });
    expect(proposeDims(stubFit({ cols: 210, rows: 64 }))).toEqual({
      cols: 210,
      rows: 64,
    });
  });

  test("floors fractional measurements to whole cells", () => {
    // A claim has to be integral: the relay rejects non-integers outright.
    expect(proposeDims(stubFit({ cols: 124.8, rows: 38.2 }))).toEqual({
      cols: 124,
      rows: 38,
    });
  });

  test("clamps into the range the relay will actually accept", () => {
    // The relay drops out-of-bounds claims rather than clamping them, so a very
    // small or very large box must be clamped here or the terminal would render
    // a grid the PTY never agreed to.
    expect(proposeDims(stubFit({ cols: 4, rows: 2 }))).toEqual({
      cols: CLAIM_BOUNDS.minCols,
      rows: CLAIM_BOUNDS.minRows,
    });
    expect(proposeDims(stubFit({ cols: 99999, rows: 99999 }))).toEqual({
      cols: CLAIM_BOUNDS.maxCols,
      rows: CLAIM_BOUNDS.maxRows,
    });
  });

  test("clamped dims are always claimable", () => {
    for (const cols of [1, 19, 20, 80, 240, 1000, 5000]) {
      for (const rows of [1, 4, 5, 24, 120, 300, 900]) {
        const { cols: c, rows: r } = clampDims({ cols, rows });
        expect(c).toBeGreaterThanOrEqual(CLAIM_BOUNDS.minCols);
        expect(c).toBeLessThanOrEqual(CLAIM_BOUNDS.maxCols);
        expect(r).toBeGreaterThanOrEqual(CLAIM_BOUNDS.minRows);
        expect(r).toBeLessThanOrEqual(CLAIM_BOUNDS.maxRows);
        expect(Number.isInteger(c) && Number.isInteger(r)).toBe(true);
      }
    }
  });

  test("refuses a box it can't measure", () => {
    // A collapsed or unlaid-out box must yield null, not a guess that would be
    // claimed and then rendered.
    expect(proposeDims(stubFit(undefined))).toBeNull();
    expect(proposeDims(stubFit({ cols: 0, rows: 0 }))).toBeNull();
    expect(proposeDims(stubFit({ cols: Number.NaN, rows: 24 }))).toBeNull();
    expect(proposeDims(stubFit({ cols: 80, rows: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  test("sameDims recognises unchanged geometry, including absence", () => {
    // Guards the claim path from re-sending an identical grid on every frame.
    expect(sameDims({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(true);
    expect(sameDims({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(false);
    expect(sameDims(null, null)).toBe(true);
    expect(sameDims({ cols: 80, rows: 24 }, null)).toBe(false);
  });
});
