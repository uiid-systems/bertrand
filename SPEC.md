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
2. **Hook scripts** — Two bash scripts (`on-blocked.sh`, `on-resumed.sh`) installed to `~/.bertrand/hooks/`. Triggered by Claude Code's hook system on `PreToolUse`/`PostToolUse` of `AskUserQuestion`.
3. **Claude Code hooks config** — Entries in `~/.claude/settings.json` that wire `AskUserQuestion` tool calls to the hook scripts.
4. **Contract** — System prompt appended via `--append-system-prompt` telling the agent to use `AskUserQuestion` for all human input, every turn, with actionable options and a "Done for now" escape.
5. **Hammerspoon** (optional) — Lua config that watches session state files and manages a focus queue for terminal windows. **NOT YET IMPLEMENTED — this is the next phase.**

### State Flow

```
User runs `bertrand` → Launch TUI → User names session → Wrapper creates session dir + state.json
→ Claude Code launches with contract + BERTRAND_PID env var
→ Agent uses AskUserQuestion → PreToolUse hook fires → state.json set to "blocked"
→ User responds → PostToolUse hook fires → state.json set to "working"
→ User exits Claude → Wrapper writes "done" state + prints exit message
```

### Hook Mechanism

Hooks are configured in `~/.claude/settings.json`:
- `PreToolUse` with matcher `AskUserQuestion` → runs `~/.bertrand/hooks/on-blocked.sh`
- `PostToolUse` with matcher `AskUserQuestion` → runs `~/.bertrand/hooks/on-resumed.sh`

Hook scripts:
1. Check `$BERTRAND_PID` env var (set by wrapper). Exit if not set (normal non-bertrand Claude session).
2. Look up session name from `~/.bertrand/tmp/<PID>` file.
3. Call `bertrand update --name <session> --status blocked/working --summary "..."`.

The `on-blocked.sh` script parses the `tool_input` JSON from stdin to extract the question as the summary.

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

### Project Source (`/Users/adamfratino/www/uiid/bertrand/`)

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
│   └── on-resumed.sh                # PostToolUse AskUserQuestion hook
├── tmp/
│   └── <PID>                        # PID-to-session-name mapping files
└── sessions/
    └── <session-name>/
        ├── state.json               # Current session state
        └── log.jsonl                # Append-only event history
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
You are running inside bertrand. Follow these rules strictly:

At session start, run: ToolSearch with query "select:AskUserQuestion" to load the tool.

After every response, you MUST call AskUserQuestion with options for the next step. Never end a turn without it. This is a continuous loop — every turn ends with AskUserQuestion. Always include a "Done for now" option so the user can exit the loop when ready.

Every option must be a concrete, actionable next step. No filler like "Have questions?" or "Want to learn more?" — if clarification is needed, phrase it as a specific action: "Discuss tradeoffs of X vs Y".
```

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

---

## What's Next: Hammerspoon Focus Queue

**This is the next phase to build.** The Hammerspoon config exists in `hooks.go` as `HammerspoonConfig()` but hasn't been tested.

### Design

- `hs.pathwatcher` on `~/.bertrand/sessions/` detects state file changes
- Builds a queue of `blocked` sessions ordered by timestamp
- When queue becomes non-empty: snapshot current frontmost app, focus the first blocked session's terminal window
- When session transitions blocked → working: remove from queue, focus next or restore snapshot
- 200ms debounce on pathwatcher callbacks

### Window Matching

- **PID-based.** Each `state.json` has a `pid` field. Hammerspoon matches terminal windows by PID via `hs.window` attributes.
- **ANSI title escape doesn't work in Warp.** Don't try it.
- Warp's CLI (`oz`) has no window management features.

### Edge Cases to Handle

- Stale state: blocked session with no matching window → skip, log warning
- Rapid transitions: debounce pathwatcher
- Snapshot target quit: let macOS handle focus naturally
- `hs.pathwatcher` may not detect changes in subdirectories — may need to watch individual session dirs or poll

### Open Questions

- Does `hs.pathwatcher` fire on changes to files within subdirectories of the watched path?
- Can Hammerspoon reliably match Warp windows by PID? Need to test `hs.window.filter` + PID matching.
- Should the Hammerspoon module expose a hotkey to manually cycle the queue?

---

## Dependencies

- Go 1.26+
- `github.com/charmbracelet/bubbletea` v1.3.10
- `github.com/charmbracelet/bubbles` v1.0.0
- `github.com/charmbracelet/lipgloss` v1.1.0
- `github.com/spf13/cobra` v1.10.2
- Claude Code 2.1.71+ (for `--append-system-prompt` and hooks)

## Distribution (Planned)

- `npx @uiid/bertrand`
- `brew install uiid/tap/bertrand`
- `go install github.com/uiid-systems/bertrand@latest`
- goreleaser for GitHub releases
