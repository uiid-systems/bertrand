import { describe, expect, test } from "bun:test";

import { authorityTransition } from "./use-sizing-authority";

describe("sizing authority", () => {
  test("takes the PTY as soon as the page is being read again", () => {
    // The reader is back and this view isn't sizing the PTY, so the grid on
    // screen is the local terminal's rather than this box's — claim immediately,
    // because this is the one transition that happens while someone is looking.
    expect(authorityTransition(true, false)).toBe("claim");
  });

  test("hands the PTY back once the page stops being read", () => {
    // Whoever the reader switched to gets the full window; the release is only
    // scheduled so that passing over the page doesn't resize the PTY twice.
    expect(authorityTransition(false, true)).toBe("schedule-release");
  });

  test("does nothing when the claim already matches who is reading", () => {
    // Focus and visibility both fire on a single switch, so the same transition
    // is evaluated more than once per change and the repeats must be inert —
    // re-claiming would resize the PTY again for no reason.
    expect(authorityTransition(true, true)).toBe("none");
    expect(authorityTransition(false, false)).toBe("none");
  });

  test("only hands back a claim it actually holds", () => {
    // Half of the invariant the hook relies on: a release is only ever scheduled
    // from the held state. The hook supplies the other half by dropping authority
    // in the same step, which together mean a pending release can't coexist with
    // a live claim — so the release path never has to cancel a timer.
    const scheduling = ([beingRead, held]: [boolean, boolean]) =>
      authorityTransition(beingRead, held) === "schedule-release";
    const cases: [boolean, boolean][] = [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ];
    for (const c of cases) {
      if (scheduling(c)) expect(c[1]).toBe(true);
    }
  });
});
