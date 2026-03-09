# bertrand — Current State Spec

## What It Is

Multi-session workflow manager for Claude Code. Named after Bertrand "ElkY" Grospellier — the Starcraft pro who became the architect of multi-tabling poker. Manages concurrent Claude Code sessions with automatic focus management, modeled after poker multi-tabling.

**Repo:** `github.com/uiid-systems/bertrand`
**Language:** Go + bubbletea (Charm)
**Version:** 0.1.0

---

## Architecture

### Core Insight

The agent doesn't know about bertrand. Claude Code hooks detect when the agent calls `AskUserQuestion` and automatically write session state. The contract only tells the agent to use `AskUserQuestion` — everything else is transparent.

### Components

1. **`bertrand` binary** — Go CLI (cobra + bubbletea). Handles launch TUI, session state, hooks, and Hammerspoon integration.
2. **Hook scripts** — Four bash scripts installed to `~/.bertrand/hooks/`:
   - `on-blocked.sh` / `on-resumed.sh` — Triggered on `AskUserQuestion` PreToolUse/PostToolUse to track blocked/working state.
   - `on-permission-wait.sh` / `on-permission-done.sh` — Catch-all PreToolUse/PostToolUse hooks that write a `pending` marker file for permission prompt detection.
3. **Claude Code hooks config** — Entries in `~/.claude/settings.json` that wire tool calls to the hook scripts.
4. **Contract** — System prompt appended via `--append-system-prompt` telling the agent to use `AskUserQuestion` for all human input, every turn, with actionable options and a "Done for now" escape.
5. **Hammerspoon** (optional) — Lua config that watches session state files and manages a focus queue for terminal windows. Sends macOS notifications, plays sounds, and auto-focuses blocked sessions.

### State Flow

```
User runs `bertrand` → Launch TUI → User names session → Wrapper creates session dir + state.json
→ Claude Code launches with contract + BERTRAND_PID env var
→ Agent uses AskUserQuestion → PreToolUse hook fires → state.json set to "blocked"
→ User responds → PostToolUse hook fires → state.json set to "working"
→ Agent calls a tool needing permission → catch-all PreToolUse writes `pending` marker
→ After 1s debounce, Hammerspoon treats as blocked → focuses window, sends notification
→ User approves/denies → catch-all PostToolUse removes `pending` marker
→ User exits Claude → Wrapper writes "done" state + prints exit message
```

### Hook Mechanism

Hooks are configured in `~/.claude/settings.json`:

**AskUserQuestion hooks (specific matcher):**
- `PreToolUse` → `~/.bertrand/hooks/on-blocked.sh` — Sets state to "blocked" with question as summary
- `PostToolUse` → `~/.bertrand/hooks/on-resumed.sh` — Sets state to "working"

**Permission detection hooks (catch-all matcher):**
- `PreToolUse` → `~/.bertrand/hooks/on-permission-wait.sh` — Writes `pending` marker file (skips AskUserQuestion)
- `PostToolUse` → `~/.bertrand/hooks/on-permission-done.sh` — Removes `pending` marker (skips AskUserQuestion)

Hook scripts:
1. Check `$BERTRAND_PID` env var (set by wrapper). Exit if not set (normal non-bertrand Claude session).
2. Look up session name from `~/.bertrand/tmp/<PID>` file.
3. For AskUserQuestion hooks: call `bertrand update --name <session> --status blocked/working --summary "..."`.
4. For permission hooks: write/remove `~/.bertrand/sessions/<session>/pending` marker file.

The `on-blocked.sh` script parses the `tool_input` JSON from stdin to extract the question as the summary.

### Permission Detection (Debounce)

When Claude Code pauses for tool permission (Edit, Bash, Write, etc.), the catch-all PreToolUse hook writes a `pending` file containing the tool name. Hammerspoon checks this file's mtime — only if it's been present for >1 second does it treat the session as blocked. This prevents auto-approved tools (which complete in milliseconds) from triggering false focus switches and notifications.

---

## CLI Surface

| Command | Action |
|---|---|
| `bertrand` | Launch TUI: type a name for new session, or browse/resume existing sessions |
| `bertrand <name>` | Resume a session by name directly (skips TUI) |
| `bertrand init` | Setup wizard: select terminal, configure Hammerspoon, install hooks |
| `bertrand list` | Interactive session picker (bubbletea TUI) |
| `bertrand update` | Write session state (agent/hook-facing, hidden from `--help`) |
| `bertrand arrange` | Interactive layout picker: tile or cascade windows (shortcut keys `t`/`c`) |
| `bertrand arrange tile` | Tile windows directly without picker |
| `bertrand arrange cascade` | Cascade windows directly without picker |
| `bertrand completion [bash\|zsh\|fish]` | Generate shell completions |

### Launch TUI (`bertrand`)

- Green gradient ASCII logo at top
- Text input with `❯` prompt, placeholder "name your session...", autocomplete from existing sessions
- Recent sessions listed below with status badges (green ● working, yellow ● blocked, dim ● done)
- **Controls:** enter start · ↑↓ browse · tab switch · d delete
- Delete: press `d` on a session → red confirmation inline → enter confirms, any key cancels
- Typing a new name + enter → new session
- Selecting existing session → resume (fresh Claude instance, not Claude `--resume`)

### Init Wizard (`bertrand init`)

- Green gradient logo
- Step-by-step: Select terminal → Enable focus queue? → Hammerspoon path
- Installs hook scripts to `~/.bertrand/hooks/`
- Injects hooks into `~/.claude/settings.json` (preserves existing settings)
- Writes `~/.bertrand/config.yaml`
- If focus queue enabled: writes `~/.hammerspoon/bertrand.lua` and auto-injects into `init.lua`
- Colored output: green ✓ checks, dimmed paths

---

## File Structure

### Project Source

```
├── main.go                          # Entry point with panic recovery
├── cmd/
│   ├── root.go                      # Root command, launch TUI, session launch/resume
│   ├── arrange.go                   # Window arrangement picker (tile/cascade with shortcuts)
│   ├── init.go                      # Setup wizard command
│   ├── list.go                      # Session picker command
│   ├── update.go                    # State update command (hidden, agent-facing)
│   └── completion.go                # Shell completion generation
├── internal/
│   ├── contract/
│   │   └── contract.go              # System prompt template
│   ├── hooks/
│   │   └── hooks.go                 # Hook script generation, settings.json injection, Hammerspoon config
│   ├── session/
│   │   └── session.go               # State read/write, PID management, directory scanning
│   └── tui/
│       ├── launch.go                # Main launch TUI model (input + session list + delete)
│       ├── list.go                  # Session picker model (used by `bertrand list`)
│       ├── logo.go                  # ASCII art logo with green gradient
│       └── wizard.go                # Init wizard model
├── go.mod
└── go.sum
```

### Runtime State (`~/.bertrand/`)

```
├── config.yaml                      # Created by `bertrand init`
├── hooks/
│   ├── on-blocked.sh                # PreToolUse AskUserQuestion hook
│   ├── on-resumed.sh                # PostToolUse AskUserQuestion hook
│   ├── on-permission-wait.sh        # PreToolUse catch-all (pending marker)
│   └── on-permission-done.sh        # PostToolUse catch-all (clear marker)
├── tmp/
│   ├── <PID>                        # PID-to-session-name mapping files
│   └── register-<session>           # Hammerspoon window registration markers
└── sessions/
    └── <session-name>/
        ├── state.json               # Current session state
        ├── log.jsonl                # Append-only event history
        └── pending                  # Permission wait marker (tool name, transient)
```

### Hammerspoon (`~/.hammerspoon/`)

```
├── bertrand.lua                     # Focus queue, notifications, window layout
└── init.lua                         # Auto-injected: require("bertrand").start()
```

### state.json

```json
{
  "session": "fix-navbar-spacing",
  "status": "working",
  "summary": "Session started",
  "pid": 48291,
  "timestamp": "2026-03-08T18:32:01Z"
}
```

Status values: `working`, `blocked`, `done`

---

## Contract (System Prompt)

Injected via `claude --append-system-prompt`:

```
You are running inside bertrand, session: {name}. Follow these rules strictly:

At session start, run: ToolSearch with query "select:AskUserQuestion" to load the tool.

After every response, you MUST call AskUserQuestion. The question field MUST start with
"{name} »" followed by your actual question. This is a continuous loop — every turn ends
with AskUserQuestion. Always include a "Done for now" option so the user can exit the
loop when ready.

Every option must be a concrete, actionable next step. No filler like "Have questions?"
or "Want to learn more?" — if clarification is needed, phrase it as a specific action:
"Discuss tradeoffs of X vs Y".

Default to multiSelect: true. Most questions benefit from letting the user pick multiple
options. Only use single-select (multiSelect: false) when the choices are truly mutually
exclusive and exactly one path must be chosen.
```

---

## Hammerspoon Focus Queue

### How It Works

- `hs.pathwatcher` on `~/.bertrand/` detects state file changes
- 0.5-second polling timer as backup (pathwatcher doesn't always catch subdirectory changes)
- Builds a queue of `blocked` sessions ordered by timestamp (FIFO)
- When queue becomes non-empty: snapshot current frontmost app, focus the first blocked session's Warp window
- When session transitions blocked → working: withdraw notification, focus next or restore snapshot
- Sends macOS notifications with Warp icon and "Hero" sound

### Window Registration

- Wrapper writes `register-<session>` marker file to `~/.bertrand/tmp/`
- Hammerspoon picks up the marker, maps the currently focused Warp window (or first unmapped Warp window) to the session name
- Window-to-session mapping persists until the window is closed

### Window Layout

- **Tile**: Grid arrangement with 8px gaps, auto-calculated rows/cols based on screen size
- **Cascade**: Staggered waterfall, 70% width, 75% height, 32px step offset
- Triggered via signal files (`signal-tile`, `signal-cascade`), acknowledged via ack files

---

## Key Design Decisions

1. **Agent doesn't know about bertrand.** Hooks handle state transitions transparently. Contract only instructs AskUserQuestion usage.
2. **AskUserQuestion is the selection UI.** Native Claude Code tool with keyboard navigation. No custom A/B/C/D letter format.
3. **Every turn ends with AskUserQuestion.** Continuous loop with actionable options and "Done for now" escape.
4. **No session.count file.** Active sessions derived by scanning `~/.bertrand/sessions/` directories.
5. **Session naming by user in TUI**, not by the agent. Wrapper handles all registration.
6. **PID-based session lookup.** Wrapper sets `BERTRAND_PID` env var. Hook scripts + `~/.bertrand/tmp/<PID>` files map PIDs to session names.
7. **Stale session recovery.** If a session directory exists but its PID is dead, the wrapper recovers it automatically.
8. **Resume = fresh Claude instance.** Bertrand "resume" restarts state tracking, doesn't use Claude's `--resume` (session UUIDs don't map to bertrand names).
9. **Hammerspoon is optional.** Core CLI works without it. Installed via `bertrand init` setup wizard.
10. **Permission detection via debounced pending markers.** Catch-all hooks write a `pending` file; Hammerspoon only acts after 1 second to avoid false positives from auto-approved tools.

---

## Dependencies

- Go 1.26+
- `github.com/charmbracelet/bubbletea` v1.3.10
- `github.com/charmbracelet/bubbles` v1.0.0
- `github.com/charmbracelet/lipgloss` v1.1.0
- `github.com/spf13/cobra` v1.10.2
- Claude Code (for `--append-system-prompt` and hooks)

## Distribution (Planned)

- `go install github.com/uiid-systems/bertrand@latest`
- goreleaser for GitHub releases
