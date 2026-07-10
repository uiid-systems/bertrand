import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";
import {
  claudeTranscriptPath,
  claudeSessionExists,
  getLatestAssistantTurn,
} from "./transcript";

// -- JSONL builders --

function userPrompt(text: string) {
  return { type: "user", message: { role: "user", content: text } };
}

function toolResult(result: string) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: result }],
    },
  };
}

function assistantText(text: string, model = "claude-fable-5") {
  return {
    type: "assistant",
    message: { role: "assistant", model, content: [{ type: "text", text }] },
  };
}

function assistantThinking(signature: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "thinking", thinking: "", signature }],
    },
  };
}

function assistantToolUse(name: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [{ type: "tool_use", id: "tu_1", name, input: {} }],
    },
  };
}

function writeTranscript(entries: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "btx-transcript-"));
  const path = join(dir, "convo.jsonl");
  writeFileSync(path, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return path;
}

describe("getLatestAssistantTurn", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const p of created) rmSync(p, { recursive: true, force: true });
    created.length = 0;
  });

  function transcript(entries: unknown[]): string {
    const path = writeTranscript(entries);
    created.push(join(path, ".."));
    return path;
  }

  test("collects the whole turn across mid-turn tool results", () => {
    const path = transcript([
      userPrompt("audit the system"),
      assistantThinking("x".repeat(2000)),
      assistantText("Let me look at the hooks first."),
      assistantToolUse("Grep"),
      toolResult("3 matches"),
      assistantThinking("y".repeat(2000)),
      assistantText("Found it — capture only happens at Stop."),
      assistantToolUse("Read"),
      toolResult("file contents"),
      assistantText("Here is what I found."),
    ]);

    const turn = getLatestAssistantTurn(path);
    expect(turn).not.toBeNull();
    expect(turn!.text).toBe(
      "Let me look at the hooks first.\n\nFound it — capture only happens at Stop.\n\nHere is what I found.",
    );
    expect(turn!.thinkingBlocks).toBe(2);
    expect(turn!.thinkingBytes).toBe(4000);
    expect(turn!.model).toBe("claude-fable-5");
  });

  test("treats an answered AskUserQuestion as a turn boundary", () => {
    const path = transcript([
      userPrompt("typed prompt"),
      assistantText("turn one text"),
      {
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-fable-5",
          content: [
            { type: "tool_use", id: "auq_1", name: "AskUserQuestion", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "auq_1",
              content: "Answer: option A",
            },
          ],
        },
      },
      assistantText("turn two text"),
      assistantToolUse("Bash"),
      toolResult("ok"),
      assistantText("turn two conclusion"),
    ]);

    const turn = getLatestAssistantTurn(path);
    expect(turn!.text).toBe("turn two text\n\nturn two conclusion");
  });

  test("stops at the most recent real user prompt", () => {
    const path = transcript([
      userPrompt("first question"),
      assistantText("answer to the first question"),
      userPrompt("second question"),
      assistantToolUse("Bash"),
      toolResult("ok"),
      assistantText("answer to the second question"),
    ]);

    const turn = getLatestAssistantTurn(path);
    expect(turn!.text).toBe("answer to the second question");
  });

  test("stops at array-content user prompts (e.g. pasted attachments)", () => {
    const path = transcript([
      assistantText("from an earlier turn"),
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: "prompt with attachment" }],
        },
      },
      assistantText("current turn"),
    ]);

    const turn = getLatestAssistantTurn(path);
    expect(turn!.text).toBe("current turn");
  });

  test("returns null when the turn has no text or thinking", () => {
    const path = transcript([
      userPrompt("do a thing"),
      assistantToolUse("Bash"),
      toolResult("ok"),
    ]);

    expect(getLatestAssistantTurn(path)).toBeNull();
  });

  test("returns null for a missing file", () => {
    expect(getLatestAssistantTurn("/nope/missing.jsonl")).toBeNull();
  });
});

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
