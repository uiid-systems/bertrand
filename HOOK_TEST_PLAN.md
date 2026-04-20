# Hook Performance Test Plan

Goal: zero perceptible difference between Claude with and without bertrand hooks.
The Go version achieved this. The TS version must match it.

## Prerequisites

Before starting, the following issues were identified and fixed:

1. **Storm CPU spin (99.5%)** — Storm's render loop continued running after the TUI exited, consuming all available CPU while Claude ran. Fixed by running TUI screens in a subprocess (`src/tui/run-screen.tsx`) that fully exits before Claude starts. The parent process never loads Storm.

2. **npx statusline (750ms/render)** — Global statusline used `npx -y ccstatusline@latest` which cost ~750ms per render. Replaced with bertrand's `statusline.sh` (~75ms) or removed entirely for testing.

3. **Lazy command loading** — `bertrand update` loaded 478 modules (including TUI framework) when only 122 were needed. Fixed with dynamic imports in `src/index.ts`. Hook invocation dropped from ~220ms to ~31ms.

4. **SQLite pragmas** — Added `synchronous=NORMAL`, `cache_size=8MB`, `temp_store=MEMORY` to `src/db/client.ts`.

## Setup

- `~/.claude/settings.json` — all bertrand hooks removed, no statusline
- `~/.claude/settings.json.bak` — backup with original config
- `~/.bertrand/bertrand.db` — cleared, fresh schema
- `~/.bertrand/hooks/` — old scripts removed; build each one incrementally per step

To restore original settings at any point:
```bash
cp ~/.claude/settings.json.bak ~/.claude/settings.json
```

## Test Procedure

For each step:
1. Build the hook script and write it to `~/.bertrand/hooks/`
2. Add the hook config to `~/.claude/settings.json`
3. Start a new bertrand session (`bun run src/index.ts`)
4. Type normally for 2-3 minutes — code edits, tool calls, questions
5. Note any lag, dropped keystrokes, or delays between tool calls
6. Check `events` table in TablePlus for write frequency
7. Record result below before moving to the next hook

## Step 0: Baseline (no hooks)

Launch a session with zero hooks, no statusline. Confirm zero lag.

```json
"hooks": {}
```

**Result:** Pass — lag-free after fixing Storm subprocess issue. Identical to vanilla Claude.

## Step 1: on-working.sh (PreToolUse catch-all)

Highest frequency hook — fires on every tool call.
Tests: process spawn cost, debounce, status update path.

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-working.sh", "timeout": 5 }]
    }
  ]
}
```

**What to watch in TablePlus:** `session.working` events. Should be sparse (debounce), not one per tool call.

**Result:** ___

## Step 2: on-blocked.sh (PreToolUse AskUserQuestion)

Fires when Claude asks a question. Tests: grep parsing, bertrand update, badge+notify.

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-working.sh", "timeout": 5 }] },
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-blocked.sh", "timeout": 10 }] }
  ]
}
```

**What to watch:** `session.block` events with question text in meta.

**Result:** ___

## Step 3: on-resumed.sh (PostToolUse AskUserQuestion)

Fires when user answers a question. Tests: answer extraction, badge clear.

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-working.sh", "timeout": 5 }] },
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-blocked.sh", "timeout": 10 }] }
  ],
  "PostToolUse": [
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-resumed.sh", "timeout": 10 }] }
  ]
}
```

**What to watch:** `session.resume` events with answer in meta.

**Result:** ___

## Step 4: on-permission-done.sh (PostToolUse catch-all)

Fires after every tool use (with fast-path exit for auto-approved tools).

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-working.sh", "timeout": 5 }] },
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-blocked.sh", "timeout": 10 }] }
  ],
  "PostToolUse": [
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-resumed.sh", "timeout": 10 }] },
    { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-permission-done.sh", "timeout": 5 }] }
  ]
}
```

**What to watch:** `permission.resolve` events. Should only appear for tools that required permission.

**Result:** ___

## Step 5: on-permission-wait.sh (PermissionRequest)

Fires when Claude requests permission for a tool.

Add to the config above:
```json
"PermissionRequest": [
  { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-permission-wait.sh", "timeout": 10 }] }
]
```

**What to watch:** `permission.request` events with tool name in meta.

**Result:** ___

## Step 6: on-done.sh (Stop)

Fires once when Claude stops. Lowest impact.

Add to the config above:
```json
"Stop": [
  { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-done.sh", "timeout": 5 }] }
]
```

**What to watch:** `session.paused` event at session end.

**Result:** ___

## Step 7: Statusline

After all hooks pass, add the statusline back:

```json
"statusLine": {
  "command": "/Users/adamfratino/.bertrand/hooks/statusline.sh",
  "type": "command"
}
```

**Result:** ___

## Key Difference: Go vs TS hooks

| Aspect | Go hooks | TS hooks |
|---|---|---|
| Binary startup | ~7ms | ~31ms (lazy) |
| Storage | File append (JSONL) | SQLite INSERT |
| State check | grep state.json | DB SELECT |
| Status update | Write state.json | DB UPDATE |
| Badge/notify | wsh commands | wsh commands |

If any step introduces lag, the options are:
1. Make the hook async (background the bertrand call)
2. Switch that specific hook back to file-based writes
3. Use a long-running daemon instead of process-per-hook
