# bertrand

Multi-session workflow manager for Claude Code. Manages concurrent Claude Code sessions with automatic focus management.

## How It Works

Bertrand wraps Claude Code sessions with a state-tracking layer. The agent doesn't know about bertrand — Claude Code hooks detect when the agent calls `AskUserQuestion` and automatically write session state. A system prompt contract tells the agent to use `AskUserQuestion` every turn with actionable options, creating a continuous input loop.

When a session needs your attention, Hammerspoon focuses the terminal window and sends a macOS notification. When you respond, the next blocked session takes focus automatically.

## Prerequisites

- **[Claude Code](https://code.claude.com/docs/en/overview)** (with `--append-system-prompt` and hooks support)
- **[Hammerspoon](https://www.hammerspoon.org/)** (optional, for focus queue and window management)
- **[Warp](https://www.warp.dev/)** terminal (currently the only supported terminal for window tracking)

## Install

```sh
brew tap uiid-systems/bertrand
brew install bertrand
```

Or with Go:

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
bertrand project/session-name
```

Shows a resume picker where you choose to start a fresh Claude conversation or resume a previous one. Bertrand sessions and Claude conversations are decoupled — the session timeline and sibling session context are injected regardless of which option you pick.

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
  log.jsonl                          # Global event log (all sessions)
  hooks/
    on-blocked.sh                    # PreToolUse AskUserQuestion hook
    on-resumed.sh                    # PostToolUse AskUserQuestion hook
    on-permission-wait.sh            # PermissionRequest hook (pending marker)
    on-permission-done.sh            # PostToolUse catch-all (clear marker)
    .version                         # Hook fingerprint (auto-reinstall detection)
  tmp/
    <PID>                            # PID-to-session-name mapping
    register-<project>___<session>   # Hammerspoon window registration marker
  sessions/
    <project>/
      <session>/
        state.json                   # Current session state
        log.jsonl                    # Append-only event history
```

### Hammerspoon (`~/.hammerspoon/`)

```
~/.hammerspoon/
  bertrand.lua                       # Focus queue, notifications, window layout
  init.lua                           # Auto-injected: require("bertrand").start()
```

## Releasing

Tag and push — goreleaser handles the rest:

```sh
git tag v0.X.Y
git push origin v0.X.Y
```

This triggers a GitHub Actions workflow that builds Darwin binaries (amd64 + arm64), creates a GitHub release, and updates the [homebrew tap](https://github.com/uiid-systems/homebrew-bertrand). Users get the update via:

```sh
brew upgrade bertrand
```

There's also a built-in command that automates version bumping, tagging, pushing, and watching the workflow:

```sh
bertrand release           # patch bump (default)
bertrand release --minor   # minor bump
bertrand release --dry-run # preview without releasing
```

## License

MIT
