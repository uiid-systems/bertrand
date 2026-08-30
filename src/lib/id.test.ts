import { describe, test, expect } from "bun:test";
import { placeholderSlug } from "@/lib/id";
import { isValidNameSegment } from "@/lib/parse-session-name";

describe("placeholderSlug", () => {
  test("shape: new- prefix plus 6 lowercased id chars", () => {
    expect(placeholderSlug()).toMatch(/^new-[a-z0-9_-]{6}$/);
  });

  test("is a valid session name segment", () => {
    // nanoid can lead with _ or -, which the segment rule forbids at the
    // start; the fixed "new-" prefix is what keeps every draw valid.
    for (let i = 0; i < 50; i++) {
      expect(isValidNameSegment(placeholderSlug())).toBe(true);
    }
  });

  test("draws differ", () => {
    expect(placeholderSlug()).not.toBe(placeholderSlug());
  });
});
