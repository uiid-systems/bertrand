# bertrand

Multi-session workflow manager for Claude Code. Named after Bertrand "ElkY" Grospellier — the Starcraft pro who became the architect of multi-tabling poker. Manages concurrent Claude Code sessions with automatic focus management, modeled after poker multi-tabling.

## How It Works

Bertrand wraps Claude Code sessions with a state-tracking layer. The agent doesn't know about bertrand — Claude Code hooks detect when the agent calls `AskUserQuestion` and automatically write session state. A system prompt contract tells the agent to use `AskUserQuestion` every turn with actionable options, creating a continuous input loop.

When a session needs your attention, Hammerspoon focuses the terminal window and sends a macOS notification. When you respond, the next blocked session takes focus automatically.

## Prerequisites

- **Go 1.26+**
- **Claude Code** (with `--append-system-prompt` and hooks support)
- **[Hammerspoon](https://www.hammerspoon.org/)** (optional, for focus queue and window management)
- **[Warp](https://www.warp.dev/)** terminal (currently the only supported terminal for window tracking)

## Install

```sh
go install github.com/uiid-systems/bertrand@latest
```

Or build from source:

```sh
git clone https://github.com/uiid-systems/bertrand.git
cd bertrand
make build
```

This installs the binary to `~/.local/bin/bertrand`. Make sure that's in your `PATH`.

## Setup

Run the setup wizard:

```sh
bertrand init
```

This will:

1. Install hook scripts to `~/.bertrand/hooks/`
2. Configure Claude Code hooks in `~/.claude/settings.json`
3. Write `~/.bertrand/config.yaml`
4. Optionally install Hammerspoon config for focus queue management

## Usage

### Launch a new session

```sh
bertrand
```

Opens an interactive TUI where you type a session name (e.g. `fix-navbar-spacing` or `ENG-142-auth-refactor`) and press enter. Claude Code launches with the bertrand contract.

### Resume a session

```sh
bertrand my-session
```

Resumes state tracking for an existing session. This starts a fresh Claude Code instance (not Claude's `--resume`) with the bertrand contract.

### Arrange windows

```sh
bertrand arrange
```

Opens a picker to tile or cascade all bertrand terminal windows. Shortcut keys: `t` for tile, `c` for cascade. You can also run directly:

```sh
bertrand arrange tile
bertrand arrange cascade
```

### List sessions

```sh
bertrand list
```

Interactive session picker showing all sessions with status badges.

## Session States

| Status | Meaning |
|--------|---------|
| **working** | Agent is generating a response |
| **blocked** | Agent called `AskUserQuestion`, waiting for your input |
| **done** | Session ended |

## Focus Queue (Hammerspoon)

When enabled via `bertrand init`, Hammerspoon watches session state files and manages a focus queue:

- When a session becomes **blocked**, your terminal window is focused and a notification with sound is sent
- When you respond, the next blocked session takes focus
- When all sessions are unblocked, your previous app is restored
- Permission prompts (Edit, Bash, Write, etc.) are also detected via a 1-second debounce — if Claude Code is waiting for tool approval for more than 1 second, it's treated as blocked

## File Layout

### Runtime state (`~/.bertrand/`)

```
~/.bertrand/
  config.yaml                        # Terminal + focus queue settings
  hooks/
    on-blocked.sh                    # PreToolUse AskUserQuestion hook
    on-resumed.sh                    # PostToolUse AskUserQuestion hook
    on-permission-wait.sh            # PreToolUse catch-all (pending marker)
    on-permission-done.sh            # PostToolUse catch-all (clear marker)
  tmp/
    <PID>                            # PID-to-session-name mapping
    register-<session>               # Hammerspoon window registration marker
  sessions/
    <session-name>/
      state.json                     # Current session state
      log.jsonl                      # Append-only event history
```

### Hammerspoon (`~/.hammerspoon/`)

```
~/.hammerspoon/
  bertrand.lua                       # Focus queue, notifications, window layout
  init.lua                           # Auto-injected: require("bertrand").start()
```

## License

MIT
