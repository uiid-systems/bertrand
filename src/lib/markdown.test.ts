import { describe, expect, test } from "bun:test";
import { normalizeEventMeta, normalizeMarkdown } from "./markdown";

describe("normalizeMarkdown", () => {
  test("converts CRLF to LF", () => {
    expect(normalizeMarkdown("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  test("converts bare CR to LF", () => {
    expect(normalizeMarkdown("a\rb\rc")).toBe("a\nb\nc");
  });

  test("preserves valid ```lang fences", () => {
    const clean = "```ts\nfoo()\n```";
    expect(normalizeMarkdown(clean)).toBe(clean);
  });

  test("leaves plain prose untouched", () => {
    expect(normalizeMarkdown("hello world")).toBe("hello world");
  });
});

describe("normalizeEventMeta", () => {
  test("normalizes recap on session.recap", () => {
    const out = normalizeEventMeta("session.recap", { recap: "a\r\nb" });
    expect(out?.recap).toBe("a\nb");
  });

  test("normalizes text on assistant.message", () => {
    const out = normalizeEventMeta("assistant.message", {
      text: "line1\r\nline2",
      model: "claude",
    });
    expect(out?.text).toBe("line1\nline2");
    expect(out?.model).toBe("claude");
  });

  test("normalizes annotation notes on session.answered", () => {
    const out = normalizeEventMeta("session.answered", {
      annotations: { "Q?": { notes: "hi\r\nthere" } },
    });
    expect(
      (out?.annotations as Record<string, { notes: string }>)["Q?"]!.notes,
    ).toBe("hi\nthere");
  });

  test("passes through unknown event types untouched", () => {
    const meta = { foo: "a\r\nb" };
    expect(normalizeEventMeta("session.active", meta)).toBe(meta);
  });

  test("handles missing meta", () => {
    expect(normalizeEventMeta("session.recap", undefined)).toBeUndefined();
  });

  test("ignores non-string fields", () => {
    const out = normalizeEventMeta("session.recap", { recap: 42 });
    expect(out?.recap).toBe(42);
  });
});
