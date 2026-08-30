import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { paths } from "@/lib/paths";

const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}

interface HookGroup {
  matcher: string;
  hooks: HookCommand[];
}

type HooksByEvent = Record<string, HookGroup[]>;

// Matchers scope hooks to specific tools — on-waiting/on-answered must only fire
// for AskUserQuestion or they'd flip session state on every tool call.
const BERTRAND_HOOKS: HooksByEvent = {
  PreToolUse: [
    {
      matcher: "AskUserQuestion",
      hooks: [{ type: "command", command: `${paths.hooks}/on-waiting.sh` }],
    },
  ],
  PostToolUse: [
    {
      matcher: "AskUserQuestion",
      hooks: [{ type: "command", command: `${paths.hooks}/on-answered.sh` }],
    },
    {
      matcher: "",
      hooks: [{ type: "command", command: `${paths.hooks}/on-permission-done.sh` }],
    },
  ],
  PermissionRequest: [
    {
      matcher: "",
      hooks: [{ type: "command", command: `${paths.hooks}/on-permission-wait.sh` }],
    },
  ],
  Stop: [
    {
      matcher: "",
      hooks: [{ type: "command", command: `${paths.hooks}/on-done.sh` }],
    },
  ],
  UserPromptSubmit: [
    {
      matcher: "",
      hooks: [{ type: "command", command: `${paths.hooks}/on-user-prompt.sh` }],
    },
  ],
};

function isBertrandGroup(group: HookGroup): boolean {
  return group.hooks?.some((h) => h.command?.includes(".bertrand/hooks/")) ?? false;
}

/**
 * Non-destructive merge of bertrand hooks into ~/.claude/settings.json.
 * Preserves all other settings and non-bertrand hook entries.
 * Claude Code schema: hooks is Record<EventType, Array<{matcher, hooks: [...]}>>.
 */
export function installHookSettings(opts: { quiet?: boolean; path?: string } = {}) {
  const settingsPath = opts.path ?? SETTINGS_PATH;
  let settings: Record<string, unknown> = {};

  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    // File doesn't exist or invalid JSON — start fresh
  }

  const existingHooks = (settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? (settings.hooks as HooksByEvent)
    : {}) as HooksByEvent;

  const merged: HooksByEvent = { ...existingHooks };

  for (const [eventType, bertrandGroups] of Object.entries(BERTRAND_HOOKS)) {
    const existing = (merged[eventType] ?? []).filter((g) => !isBertrandGroup(g));
    merged[eventType] = [...existing, ...bertrandGroups];
  }

  // Prune bertrand groups under event types we no longer install — leftovers
  // from retired hooks would otherwise fire scripts this binary doesn't ship.
  for (const eventType of Object.keys(merged)) {
    if (eventType in BERTRAND_HOOKS) continue;
    const kept = merged[eventType]!.filter((g) => !isBertrandGroup(g));
    if (kept.length > 0) merged[eventType] = kept;
    else delete merged[eventType];
  }

  settings.hooks = merged;

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  if (!opts.quiet) console.log(`Updated ${settingsPath} with bertrand hooks`);
}

/**
 * True when settings.json carries exactly the bertrand hook groups this
 * binary would install — per event type, the bertrand-owned groups must match
 * BERTRAND_HOOKS verbatim. Non-bertrand groups are ignored.
 */
export function hookSettingsAreCurrent(opts: { path?: string } = {}): boolean {
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(opts.path ?? SETTINGS_PATH, "utf-8"));
  } catch {
    return false;
  }

  const hooks = (settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
    ? (settings.hooks as HooksByEvent)
    : {}) as HooksByEvent;

  const eventTypes = new Set([...Object.keys(hooks), ...Object.keys(BERTRAND_HOOKS)]);
  for (const eventType of eventTypes) {
    const actual = (hooks[eventType] ?? []).filter(isBertrandGroup);
    const expected = BERTRAND_HOOKS[eventType] ?? [];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  }
  return true;
}
