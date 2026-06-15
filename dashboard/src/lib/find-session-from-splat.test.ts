import { describe, test, expect } from "bun:test";
import { findSessionFromSplat } from "./find-session-from-splat";
import type { SessionWithCategory } from "../api/types";

function stub(categoryPath: string, slug: string): SessionWithCategory {
  return {
    categoryPath,
    session: { id: `${categoryPath}/${slug}`, slug } as SessionWithCategory["session"],
  };
}

describe("findSessionFromSplat", () => {
  const sessions = [
    stub("ssp", "REV-367/fe-determination"),
    stub("ssp", "REV-200/api"),
    stub("uiid/bertrand", "fix-auth"),
    stub("infra", "deploy"),
  ];

  test("matches flat category + slash-bearing slug", () => {
    expect(findSessionFromSplat("ssp/REV-367/fe-determination", sessions)).toBe(
      sessions[0],
    );
  });

  test("matches legacy nested-category path", () => {
    expect(findSessionFromSplat("uiid/bertrand/fix-auth", sessions)).toBe(
      sessions[2],
    );
  });

  test("matches a two-segment session", () => {
    expect(findSessionFromSplat("infra/deploy", sessions)).toBe(sessions[3]);
  });

  test("strips leading/trailing slashes", () => {
    expect(findSessionFromSplat("/ssp/REV-200/api/", sessions)).toBe(sessions[1]);
  });

  test("returns null for a category-only path", () => {
    expect(findSessionFromSplat("ssp", sessions)).toBeNull();
    expect(findSessionFromSplat("", sessions)).toBeNull();
  });

  test("returns null for a non-existent session", () => {
    expect(findSessionFromSplat("ssp/no-such-slug", sessions)).toBeNull();
  });

  test("does not greedily split on the last slash", () => {
    // Older logic would have matched categoryPath="ssp/REV-367" and missed it.
    expect(
      findSessionFromSplat("ssp/REV-367/fe-determination", sessions)
        ?.categoryPath,
    ).toBe("ssp");
  });
});
