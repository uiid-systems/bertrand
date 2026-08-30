import { describe, expect, test } from "bun:test";

import { parseNameStatus, parseNumstat } from "./git";

describe("parseNumstat", () => {
  test("parses added/removed counts per path", () => {
    const out = "12\t3\tsrc/app.tsx\n0\t189\tsrc/pages/old-page.tsx\n";
    const counts = parseNumstat(out);
    expect(counts.get("src/app.tsx")).toEqual({ added: 12, removed: 3 });
    expect(counts.get("src/pages/old-page.tsx")).toEqual({ added: 0, removed: 189 });
  });

  test("binary files ('-' counts) parse as null", () => {
    const counts = parseNumstat("-\t-\tassets/logo.png\n");
    expect(counts.get("assets/logo.png")).toEqual({ added: null, removed: null });
  });

  test("ignores blank lines and keeps tabs inside paths", () => {
    const counts = parseNumstat("\n1\t1\tweird\tpath.txt\n\n");
    expect(counts.size).toBe(1);
    expect(counts.get("weird\tpath.txt")).toEqual({ added: 1, removed: 1 });
  });
});

describe("parseNameStatus", () => {
  test("maps A/D/M letters to statuses", () => {
    const statuses = parseNameStatus(
      "A\tsrc/new.ts\nD\tsrc/gone.ts\nM\tsrc/edited.ts\n",
    );
    expect(statuses.get("src/new.ts")).toBe("added");
    expect(statuses.get("src/gone.ts")).toBe("deleted");
    expect(statuses.get("src/edited.ts")).toBe("modified");
  });

  test("unknown letters fall back to modified, blanks are skipped", () => {
    const statuses = parseNameStatus("T\tsrc/typechange.ts\n\n");
    expect(statuses.size).toBe(1);
    expect(statuses.get("src/typechange.ts")).toBe("modified");
  });
});
