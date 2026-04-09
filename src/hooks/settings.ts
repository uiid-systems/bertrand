import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { paths } from "../lib/paths.ts";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

/**
 * Non-destructive merge of bertrand hooks into ~/.claude/settings.json.
 * Preserves all existing settings. Only adds/updates bertrand hook entries.
 */
export function installHookSettings() {
  let settings: Record<string, unknown> = {};

  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  const hooks = (settings.hooks ?? []) as HookEntry[];

  // Remove existing bertrand hooks (we'll re-add them)
  const cleaned = hooks.filter(
    (h) => !h.hooks?.some((hh) => hh.command?.includes(".bertrand/hooks/"))
  );

  const bertrandHooks: HookEntry[] = [
    {
      matcher: "PreToolUse",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-blocked.sh`,
        },
      ],
    },
    {
      matcher: "PostToolUse",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-resumed.sh`,
        },
      ],
    },
    {
      matcher: "PreToolUse",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-working.sh`,
        },
      ],
    },
    {
      matcher: "PermissionRequest",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-permission-wait.sh`,
        },
      ],
    },
    {
      matcher: "PostToolUse",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-permission-done.sh`,
        },
      ],
    },
    {
      matcher: "Stop",
      hooks: [
        {
          type: "command",
          command: `${paths.hooks}/on-done.sh`,
        },
      ],
    },
  ];

  settings.hooks = [...cleaned, ...bertrandHooks];

  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");

  console.log(`Updated ${SETTINGS_PATH} with bertrand hooks`);
}
