# Hook Performance Test Plan

Goal: zero perceptible difference between Claude with and without bertrand hooks.
The Go version achieved this. The TS version must match it.

## Prerequisites

Before starting, the following issues were identified and fixed:

1. **Storm CPU spin (99.5%)** — Storm's render loop continued running after the TUI exited, consuming all available CPU while Claude ran. Fixed by running TUI screens in a subprocess (`src/tui/run-screen.tsx`) that fully exits before Claude starts. The parent process never loads Storm.

2. **npx statusline (750ms/render)** — Global statusline used `npx -y ccstatusline@latest` which cost ~750ms per render. Replaced with bertrand's `statusline.sh` (~75ms) or removed entirely for testing.

3. **Lazy command loading** — `bertrand update` loaded 478 modules (including TUI framework) when only 122 were needed. Fixed with dynamic imports in `src/index.ts`. Hook invocation dropped from ~220ms to ~31ms.

4. **SQLite pragmas** — Added `synchronous=NORMAL`, `cache_size=8MB`, `temp_store=MEMORY` to `src/db/client.ts`.

5. **State rename** — `working/blocked/prompting` → `active/waiting` (prompting removed). Events renamed: `session.block` → `session.waiting`, `session.working` → `session.active`, `session.resume` → `session.answered`.

## Setup

- `~/.claude/settings.json` — hooks added incrementally per step
- `~/.claude/settings.json.bak` — backup with original config
- `~/.bertrand/bertrand.db` — cleared, fresh schema
- `~/.bertrand/bin/bertrand` — compiled TS binary (hooks must call this, not the Go binary in PATH)
- `~/.bertrand/hooks/` — build each hook incrementally per step

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
6. Check `events` table in TablePlus for write frequency and correctness
7. Record result below before moving to the next hook

## Step 0: Baseline (no hooks)

Launch a session with zero hooks, no statusline. Confirm zero lag.

```json
"hooks": {}
```

**Result:** Pass — lag-free after fixing Storm subprocess issue. Identical to vanilla Claude.

## Step 1: on-active.sh (PreToolUse catch-all)

Highest frequency hook — fires on every tool call.
Tests: process spawn cost, debounce, status update path.

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "",
      "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-active.sh", "timeout": 5 }]
    }
  ]
}
```

**What to watch in TablePlus:** `session.active` events. Should be sparse (debounce), not one per tool call.

**Result:** Pass — no lag, DB writes correct. Required fixing hooks to call `~/.bertrand/bin/bertrand` (TS binary) instead of bare `bertrand` (Go binary). Confirmed after state rename.

## Step 2: on-waiting.sh (PreToolUse AskUserQuestion)

Fires when Claude asks a question. Tests: grep parsing, bertrand update, badge+notify.

```json
"hooks": {
  "PreToolUse": [
    { "matcher": "", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-active.sh", "timeout": 5 }] },
    { "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "/Users/adamfratino/.bertrand/hooks/on-waiting.sh", "timeout": 10 }] }
  ]
}
```

**What to watch:** `session.waiting` events with question text in meta.

**Result:** Pass — session.waiting events with question text. Badge + notify working. No lag.

## Step 3: on-answered.sh (PostToolUse AskUserQuestion)

Fires when user answers a question. Tests: answer extraction, badge clear.

**What to watch:** `session.answered` events with answer in meta.

**Result:** Pass — answers captured in meta. Badge clears. Timing pairs (waiting→answered) visible. No lag.

## Step 4: on-done.sh (Stop)

Fires once when Claude stops. Lowest impact.

**What to watch:** `session.paused` event at session end.

**Result:** Pass — session.paused at end, green badge. No lag.

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
