import { describe, test, expect, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  CLAUDE_COMMANDS,
  MANAGED_MARKER,
  claudeCommandsAreCurrent,
  installClaudeCommands,
} from "./commands";

const BIN = "/usr/local/bin/bertrand";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bertrand-commands-"));
});

describe("installClaudeCommands", () => {
  test("writes /bertrand with this binary's path baked in", () => {
    installClaudeCommands(BIN, { dir, quiet: true });

    const body = readFileSync(join(dir, "bertrand.md"), "utf-8");
    expect(body).toContain(`${BIN} adopt`);
    // --mark-sent is what stops the next UserPromptSubmit from delivering the
    // full contract a second time.
    expect(body).toContain(`${BIN} contract --mark-sent`);
  });

  test("declares the two commands it runs as allowed tools", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    const body = readFileSync(join(dir, "bertrand.md"), "utf-8");

    // Without these the command's first act is two permission prompts, which
    // is the opposite of the zero-follow-ups goal.
    expect(body).toContain(
      `allowed-tools: Bash(${BIN} adopt:*), Bash(${BIN} contract:*)`,
    );
  });

  test("passes the user's request through to the activated session", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    // `/bertrand fix the flaky test` should start on the work, not just attach.
    expect(readFileSync(join(dir, "bertrand.md"), "utf-8")).toContain("$ARGUMENTS");
  });

  test("creates the commands directory when claude has never made one", () => {
    const fresh = join(dir, "nested", "commands");
    installClaudeCommands(BIN, { dir: fresh, quiet: true });
    expect(existsSync(join(fresh, "bertrand.md"))).toBe(true);
  });

  test("leaves no temp files behind", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    // Write-then-rename: a half-written .tmp- file sitting in the user's
    // commands directory would be visible clutter at best.
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  test("overwrites its own file on reinstall", () => {
    writeFileSync(join(dir, "bertrand.md"), "stale contents");
    installClaudeCommands(BIN, { dir, quiet: true });
    expect(readFileSync(join(dir, "bertrand.md"), "utf-8")).not.toBe("stale contents");
  });
});

describe("orphan cleanup", () => {
  test("removes a command bertrand shipped in an earlier version", () => {
    writeFileSync(
      join(dir, "bertrand-attach.md"),
      `---\ndescription: old\n---\n\n${MANAGED_MARKER}\n\nRetired.\n`,
    );

    installClaudeCommands(BIN, { dir, quiet: true });

    expect(existsSync(join(dir, "bertrand-attach.md"))).toBe(false);
  });

  test("never touches a command the user wrote", () => {
    // ~/.claude/commands is the user's directory, not ours — the hooks dir can
    // be swept wholesale, this one cannot.
    const mine = join(dir, "deploy.md");
    writeFileSync(mine, "Deploy the thing.\n");

    installClaudeCommands(BIN, { dir, quiet: true });

    expect(readFileSync(mine, "utf-8")).toBe("Deploy the thing.\n");
  });

  test("never touches a user command that merely mentions bertrand", () => {
    // Ownership is the marker, not the name — otherwise a personal
    // `bertrand-notes.md` would vanish on the next upgrade.
    const mine = join(dir, "bertrand-notes.md");
    writeFileSync(mine, "Notes on how I use bertrand.\n");

    installClaudeCommands(BIN, { dir, quiet: true });

    expect(existsSync(mine)).toBe(true);
  });

  test("ignores non-markdown files", () => {
    const readme = join(dir, "notes.txt");
    writeFileSync(readme, MANAGED_MARKER);

    installClaudeCommands(BIN, { dir, quiet: true });

    expect(existsSync(readme)).toBe(true);
  });
});

describe("claudeCommandsAreCurrent", () => {
  test("is false before anything is installed", () => {
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(false);
  });

  test("is true immediately after install", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(true);
  });

  test("is false when the binary path changed", () => {
    installClaudeCommands("/old/path/bertrand", { dir, quiet: true });
    // This is the upgrade case: the file still exists but points at a bin that
    // may no longer be there, so self-healing has to notice.
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(false);
  });

  test("is false when the file was edited by hand", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    writeFileSync(join(dir, "bertrand.md"), "rewritten\n");
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(false);
  });

  test("is false while a retired command is still installed", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    writeFileSync(join(dir, "bertrand-old.md"), MANAGED_MARKER);
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(false);
  });

  test("stays true alongside the user's own commands", () => {
    installClaudeCommands(BIN, { dir, quiet: true });
    writeFileSync(join(dir, "deploy.md"), "Deploy the thing.\n");
    // A user adding commands must not put bertrand into a permanent
    // reinstall-on-every-hook-tick loop.
    expect(claudeCommandsAreCurrent(BIN, { dir })).toBe(true);
  });
});

describe("the command set", () => {
  test("ships /bertrand at the top level so it is not namespaced", () => {
    // commands/bertrand/start.md would be /bertrand:start, not /bertrand.
    expect(Object.keys(CLAUDE_COMMANDS)).toEqual(["bertrand.md"]);
  });

  test("stamps every file it owns", () => {
    for (const render of Object.values(CLAUDE_COMMANDS)) {
      expect(render(BIN)).toContain(MANAGED_MARKER);
    }
  });
});
