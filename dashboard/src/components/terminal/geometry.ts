import type { FitAddon } from "@xterm/addon-fit";

/**
 * Geometry rules for embedding a terminal in a resizable box.
 *
 * The font size is **fixed**. A terminal's text does not grow or shrink with its
 * window — resizing changes how many rows and columns fit, and the program
 * attached to it reflows to the new grid. Scaling the font instead (to letterbox
 * a fixed grid into an arbitrary box) keeps the geometry constant at the cost of
 * making the text unreadable at small sizes, and it doesn't behave like a
 * terminal. So the box decides `cols`/`rows`, and the PTY is asked to match via
 * `{t:"claim"}` (see src/server/terminal-relay.ts).
 *
 * The PTY is shared with the local terminal, so a claim is a request, not a
 * command: upstream applies the smaller of the claim and its own terminal on each
 * axis (`smallestDims` in src/engine/pty.ts) and reports the result back as
 * `{t:"dims"}`. The emulator renders that reported geometry, which is why a box
 * larger than the local terminal shows some unused margin rather than a grid
 * nothing else can display.
 */

export interface Dims {
  cols: number;
  rows: number;
}

/**
 * Cell grid the terminal renders at before upstream has reported anything —
 * the conventional default, replaced as soon as a `dims` frame lands.
 */
export const FALLBACK_DIMS: Dims = { cols: 80, rows: 24 };

/**
 * Default font size, and the range the reader can pick from. Fixed with respect
 * to the *container* — the point of this module — but a preference the reader can
 * set once, exactly like the font size setting in a terminal app. See
 * ./use-terminal-font-size.ts.
 */
export const DEFAULT_FONT_SIZE = 13;
export const FONT_SIZE_BOUNDS = { min: 8, max: 24 } as const;

/**
 * Claim bounds, kept in step with `CLAIM_BOUNDS` in
 * src/server/terminal-relay.ts. The relay *drops* a claim outside these rather
 * than clamping it, so clamping here is what keeps a very small or very large
 * box from silently producing a claim that is ignored — the terminal would then
 * render a grid the PTY never agreed to.
 */
export const CLAIM_BOUNDS = {
  minCols: 20,
  maxCols: 1000,
  minRows: 5,
  maxRows: 300,
} as const;

export function clampDims({ cols, rows }: Dims): Dims {
  return {
    cols: Math.min(CLAIM_BOUNDS.maxCols, Math.max(CLAIM_BOUNDS.minCols, cols)),
    rows: Math.min(CLAIM_BOUNDS.maxRows, Math.max(CLAIM_BOUNDS.minRows, rows)),
  };
}

/**
 * The grid that fits the terminal's current box at the fixed font size, or null
 * when the box isn't measurable yet (collapsed, or not laid out). Delegates the
 * measuring to the fit addon, which accounts for the terminal's padding and
 * scrollbar, then clamps into claimable range.
 */
export function proposeDims(fit: FitAddon): Dims | null {
  const proposed = fit.proposeDimensions();
  if (!proposed?.cols || !proposed?.rows) return null;
  if (!Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) {
    return null;
  }
  return clampDims({
    cols: Math.floor(proposed.cols),
    rows: Math.floor(proposed.rows),
  });
}

export function sameDims(a: Dims | null, b: Dims | null): boolean {
  return a?.cols === b?.cols && a?.rows === b?.rows;
}
