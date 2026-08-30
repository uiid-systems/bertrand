import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { installHookSettings } from "./settings";

let workDir: string;
let settingsPath: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "bertrand-settings-"));
  settingsPath = join(workDir, "settings.json");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const readSettings = () => JSON.parse(readFileSync(settingsPath, "utf-8"));
const matchersFor = (event: string): string[] =>
  (readSettings().hooks?.[event] ?? []).map((g: { matcher: string }) => g.matcher);

/**
 * The retired worktree hooks were matcher-scoped groups on `PostToolUse`, an
 * event type bertrand still installs. The prune loop deliberately skips such
 * event types, so removal rides entirely on the merge loop replacing every
 * bertrand-owned group under them. If that ever regressed, a stale group would
 * survive in every user's settings.json forever and silently fire a script this
 * binary no longer ships.
 */
describe("installHookSettings retires matcher-scoped groups", () => {
  test("removes bertrand's EnterWorktree and ExitWorktree PostToolUse groups", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "EnterWorktree",
              hooks: [{ type: "command", command: "/Users/x/.bertrand/hooks/on-enter-worktree.sh" }],
            },
            {
              matcher: "ExitWorktree",
              hooks: [{ type: "command", command: "/Users/x/.bertrand/hooks/on-exit-worktree.sh" }],
            },
          ],
        },
      }),
    );

    installHookSettings({ quiet: true, path: settingsPath });

    expect(matchersFor("PostToolUse")).not.toContain("EnterWorktree");
    expect(matchersFor("PostToolUse")).not.toContain("ExitWorktree");
  });

  test("leaves no reference to the retired worktree hook scripts anywhere", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              matcher: "EnterWorktree",
              hooks: [{ type: "command", command: "/Users/x/.bertrand/hooks/on-enter-worktree.sh" }],
            },
          ],
        },
      }),
    );

    installHookSettings({ quiet: true, path: settingsPath });

    const written = readFileSync(settingsPath, "utf-8");
    expect(written).not.toContain("on-enter-worktree.sh");
    expect(written).not.toContain("on-exit-worktree.sh");
  });
});

/**
 * `~/.claude/settings.json` is shared with Orca and RTK. bertrand must only
 * ever touch groups whose command lives under `.bertrand/hooks/`.
 */
describe("installHookSettings coexists with other tools", () => {
  const orcaGroup = {
    matcher: "",
    hooks: [{ type: "command", command: "/Users/x/.orca/agent-hook-listener.js" }],
  };
  const rtkGroup = {
    matcher: "Bash",
    hooks: [{ type: "command", command: "/usr/local/bin/rtk hook" }],
  };

  test("preserves other tools' hook groups and non-hook settings", () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        statusLine: { type: "command", command: "orca statusline" },
        hooks: { PostToolUse: [orcaGroup, rtkGroup], Notification: [orcaGroup] },
      }),
    );

    installHookSettings({ quiet: true, path: settingsPath });
    const out = readSettings();

    expect(out.statusLine).toEqual({ type: "command", command: "orca statusline" });
    expect(out.hooks.PostToolUse).toEqual(expect.arrayContaining([orcaGroup, rtkGroup]));
    expect(out.hooks.Notification).toEqual(expect.arrayContaining([orcaGroup]));
  });
});
