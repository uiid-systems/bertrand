import { describe, test, expect } from "bun:test";
import { findSessionFromSplat } from "./find-session-from-splat";
import type { SessionListRow } from "../api/types";

function stub(slug: string): SessionListRow {
  return {
    session: { id: slug, slug } as SessionListRow["session"],
  };
}

describe("findSessionFromSplat", () => {
  const sessions = [
    stub("REV-367/fe-determination"),
    stub("REV-200/api"),
    stub("fix-auth"),
    stub("deploy"),
  ];

  test("matches a plain slug", () => {
    expect(findSessionFromSplat("fix-auth", sessions)).toBe(sessions[2]);
  });

  test("matches a slash-bearing slug as one identity", () => {
    expect(findSessionFromSplat("REV-367/fe-determination", sessions)).toBe(
      sessions[0],
    );
  });

  test("strips leading/trailing slashes", () => {
    expect(findSessionFromSplat("/REV-200/api/", sessions)).toBe(sessions[1]);
  });

  test("returns null for an empty splat", () => {
    expect(findSessionFromSplat("", sessions)).toBeNull();
    expect(findSessionFromSplat("//", sessions)).toBeNull();
  });

  test("returns null for a non-existent session", () => {
    expect(findSessionFromSplat("no-such-slug", sessions)).toBeNull();
  });

  test("does not match on a slug prefix or suffix", () => {
    // A retired "<category>/<slug>" URL must miss cleanly, not half-match.
    expect(findSessionFromSplat("old-category/deploy", sessions)).toBeNull();
  });
});
