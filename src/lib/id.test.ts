import { describe, test, expect } from "bun:test";
import { placeholderSlug, slugFromBranch } from "@/lib/id";
import { isValidNameSegment } from "@/lib/parse-session-name";

describe("placeholderSlug", () => {
  test("shape: new- prefix plus 6 lowercased id chars", () => {
    expect(placeholderSlug()).toMatch(/^new-[a-z0-9]{6}$/);
  });

  test("is a valid session name segment", () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidNameSegment(placeholderSlug())).toBe(true);
    }
  });

  test("never ends in punctuation", () => {
    // The default nanoid alphabet includes - and _, which produced names like
    // `new-etxcb-`. The custom alphabet is what rules that out.
    for (let i = 0; i < 200; i++) {
      expect(placeholderSlug()).not.toMatch(/[^a-z0-9]$/);
    }
  });

  test("draws differ", () => {
    expect(placeholderSlug()).not.toBe(placeholderSlug());
  });
});

describe("slugFromBranch", () => {
  test("a plain branch is already a slug", () => {
    expect(slugFromBranch("elky-189")).toBe("elky-189");
  });

  test("drops the owner or type prefix", () => {
    expect(slugFromBranch("adamfratino/ui-196-fix-the-ramp")).toBe(
      "ui-196-fix-the-ramp",
    );
    expect(slugFromBranch("feature/foo")).toBe("foo");
    // Deeper nesting still keeps only the last component.
    expect(slugFromBranch("team/adam/bg-5")).toBe("bg-5");
  });

  test("no branch yields no slug", () => {
    expect(slugFromBranch(null)).toBeNull();
    expect(slugFromBranch(undefined)).toBeNull();
    expect(slugFromBranch("")).toBeNull();
  });

  test("default branches are not a name", () => {
    // A session on the default branch is one of many — seeding from it would
    // file unrelated work as main, main-2, main-3.
    for (const b of ["main", "master", "trunk", "dev", "develop", "MAIN"]) {
      expect(slugFromBranch(b)).toBeNull();
    }
    // Only an exact match is generic; these name real work.
    expect(slugFromBranch("main-menu-redesign")).toBe("main-menu-redesign");
    expect(slugFromBranch("develop-a-thing")).toBe("develop-a-thing");
  });

  test("lowercases, and collapses characters a segment can't hold", () => {
    expect(slugFromBranch("UI-132")).toBe("ui-132");
    expect(slugFromBranch("fix (the) thing")).toBe("fix-the-thing");
    expect(slugFromBranch("a++++b")).toBe("a-b");
  });

  test("never leads or trails with punctuation", () => {
    expect(slugFromBranch("--wip--")).toBe("wip");
    expect(slugFromBranch("___x___")).toBe("x");
    // A branch that reduces to nothing has no name in it.
    expect(slugFromBranch("---")).toBeNull();
    expect(slugFromBranch("///")).toBeNull();
  });

  test("every result is a valid session name segment", () => {
    const branches = [
      "elky-189",
      "adamfratino/ui-196-calibrate-the-fill-ramp-steps-for-perception",
      "UI-132",
      "fix (the) thing",
      "--wip--",
      "release/v1.2.3",
      "9-lives",
    ];
    for (const b of branches) {
      const slug = slugFromBranch(b);
      if (slug === null) continue;
      expect(isValidNameSegment(slug)).toBe(true);
    }
  });

  test("long branches are cut at a token boundary, not mid-word", () => {
    const slug = slugFromBranch(
      "ui-196-calibrate-the-fill-ramp-steps-for-perceptual-evenness",
    );
    expect(slug).not.toBeNull();
    expect(slug!.length).toBeLessThanOrEqual(48);
    // Cut on a dash, so the tail is a whole word rather than "percep".
    expect(slug).toBe("ui-196-calibrate-the-fill-ramp-steps-for");
    expect(slug).not.toMatch(/[^a-z0-9]$/);
  });

  test("a single over-long token is cut rather than dropped", () => {
    const slug = slugFromBranch("a".repeat(60));
    expect(slug).toBe("a".repeat(48));
  });
});
