import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { claudeTranscriptPath, claudeSessionExists } from "./transcript";

describe("claudeTranscriptPath", () => {
  test("encodes the cwd by replacing slashes with dashes", () => {
    expect(claudeTranscriptPath("abc", "/Users/me/proj/app")).toBe(
      join(homedir(), ".claude", "projects", "-Users-me-proj-app", "abc.jsonl")
    );
  });

  test("uses process.cwd() when no cwd is passed", () => {
    const path = claudeTranscriptPath("abc");
    expect(path).toContain(`.claude/projects/`);
    expect(path).toContain("abc.jsonl");
  });
});

describe("claudeSessionExists", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const p of created) rmSync(p, { recursive: true, force: true });
    created.length = 0;
  });

  test("false when the transcript file is missing", () => {
    const cwd = mkdtempSync(join(tmpdir(), "btx-cwd-"));
    created.push(cwd);
    expect(claudeSessionExists("definitely-not-real-uuid", cwd)).toBe(false);
  });

  test("true when the transcript file exists at the encoded path", () => {
    const cwd = mkdtempSync(join(tmpdir(), "btx-cwd-"));
    created.push(cwd);
    const path = claudeTranscriptPath("test-uuid", cwd);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "");
    created.push(join(homedir(), ".claude", "projects", cwd.replace(/\//g, "-")));
    expect(claudeSessionExists("test-uuid", cwd)).toBe(true);
  });
});
