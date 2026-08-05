import { useEffect, useRef, type RefObject } from "react";

/**
 * Which attached view gets to size the PTY.
 *
 * A PTY has exactly one size. Upstream gives it the smallest of everything
 * attached (tmux's smallest-attached-client rule, `smallestDims` in
 * src/engine/pty.ts), so a dashboard panel and the local terminal window cannot
 * both render at their natural width — whichever is larger gets unused margin,
 * and which one that is changes as windows move. Settling it once, in either
 * direction, is wrong half the time: claiming always caps a wide terminal
 * window to a narrow panel, and never claiming leaves the panel displaying a
 * grid far too big for it.
 *
 * So the PTY follows the reader instead. While the page is being read this view
 * claims the grid its box needs; when the reader looks away it hands the PTY
 * back, and the terminal window they switched to gets its full width.
 *
 * The asymmetry that makes this cheap is that **the released state is never
 * seen**. Nobody is reading a page they have switched away from, so a grid too
 * big for the box only has to be corrected before it becomes visible again —
 * which is what regaining focus does. That is why this needs no font scaling or
 * horizontal scrolling to present an oversized grid: it is only ever oversized
 * while unwatched.
 */

/**
 * How long the view has to stay unread before it gives the PTY back.
 *
 * Releasing resizes a real PTY and makes the attached TUI repaint, so alt-tabbing
 * past the dashboard shouldn't cost two resizes on the way through. Long enough
 * to ignore a glance, short enough that by the time someone has switched to the
 * terminal and started reading, it has its full width back.
 */
const RELEASE_DELAY_MS = 400;

/**
 * Whether this view is the one being read: the tab is visible *and* the window
 * has focus. Visibility alone would keep authority while the reader is in
 * another app, and focus alone misses a background tab in a focused window.
 */
function isBeingRead(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * What a change in whether the page is being read means for the claim.
 *
 * `claim` and `release` are asymmetric on purpose: authority is taken the
 * instant the reader returns, but handed back only after a delay, so passing
 * over the page doesn't resize the PTY twice.
 */
export type AuthorityAction = "none" | "claim" | "schedule-release";

/**
 * The whole policy, as a pure function so it can be tested without a DOM.
 *
 * Note that "being read but not holding" is the only case that claims, and
 * "holding but not being read" the only case that releases — so authority is
 * always dropped in the same step that schedules the handover, which is what
 * guarantees a pending release can never coexist with held authority.
 */
export function authorityTransition(
  beingRead: boolean,
  held: boolean,
): AuthorityAction {
  if (beingRead) return held ? "none" : "claim";
  return held ? "schedule-release" : "none";
}

export interface SizingAuthorityCallbacks {
  /** Ask for the grid this view's box needs, now rather than on a debounce. */
  claim: () => void;
  /** Give the PTY back to the local terminal. */
  release: () => void;
}

export interface SizingAuthority {
  /**
   * Whether this view currently sizes the PTY.
   *
   * A ref rather than state because the resize path reads it synchronously: a
   * stale closure there would either re-claim a grid just given up or hold one
   * meant to be released. Callers must gate their claiming on it — releasing
   * makes upstream report the local terminal's grid, which arrives as a resize,
   * so an ungated resize handler would re-claim and undo the release.
   */
  held: RefObject<boolean>;
}

/**
 * Tracks whether this view should be sizing the PTY, and drives the handover.
 * `claim` fires as soon as the page is read again; `release` fires once it has
 * been unread for `RELEASE_DELAY_MS`.
 */
export function useSizingAuthority({
  claim,
  release,
}: SizingAuthorityCallbacks): SizingAuthority {
  const held = useRef(true);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cancelRelease = () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
      releaseTimer.current = null;
    };

    const sync = () => {
      switch (authorityTransition(isBeingRead(), held.current)) {
        case "claim":
          // Whatever handover was in flight is off — the reader is back.
          cancelRelease();
          held.current = true;
          claim();
          return;
        case "schedule-release":
          // Authority drops now so nothing re-claims during the grace period;
          // only the handover upstream waits it out.
          held.current = false;
          releaseTimer.current = setTimeout(() => {
            releaseTimer.current = null;
            // Re-checked on the way out: a quick switch away and back leaves
            // authority restored, and releasing then would fight the live claim.
            if (!held.current) release();
          }, RELEASE_DELAY_MS);
          return;
        case "none":
          return;
      }
    };

    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      cancelRelease();
    };
  }, [claim, release]);

  return { held };
}
