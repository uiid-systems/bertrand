# bertrand

Multi-session workflow manager for Claude Code. Manages concurrent Claude Code sessions with automatic focus management.

## How It Works

Bertrand wraps Claude Code sessions with a state-tracking layer. The agent doesn't know about bertrand — Claude Code hooks detect when the agent calls `AskUserQuestion` and automatically write session state. A system prompt contract tells the agent to use `AskUserQuestion` every turn with actionable options, creating a continuous input loop.

When a session needs your attention, Wave Terminal is activated and the blocked session's block is focused, with a notification and badge. When you respond, the badge clears.

## Prerequisites

- **[Claude Code](https://code.claude.com/docs/en/overview)** (with `--append-system-prompt` and hooks support)
- **[Wave Terminal](https://www.waveterm.dev/)** (recommended, for focus management, notifications, and badges)

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
4. Install Wave widget config (if Wave detected)

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

## Focus Management (Wave)

When a session becomes **blocked** (agent calls `AskUserQuestion`), hooks automatically:

- Set a colored badge on the block's tab header via `wsh badge`
- Send a Wave notification via `wsh notify`
- Optionally steal OS focus and switch to the block (requires `auto_focus: true` in `~/.bertrand/config.yaml`)

## File Layout

### Runtime state (`~/.bertrand/`)

```
~/.bertrand/
  config.yaml                        # Terminal + Wave settings
  log.jsonl                          # Global event log (all sessions)
  hooks/
    on-blocked.sh                    # PreToolUse AskUserQuestion hook
    on-resumed.sh                    # PostToolUse AskUserQuestion hook
    on-permission-wait.sh            # PermissionRequest hook (pending marker)
    on-permission-done.sh            # PostToolUse catch-all (clear marker)
    .version                         # Hook fingerprint (auto-reinstall detection)
  tmp/
    <PID>                            # PID-to-session-name mapping
  sessions/
    <project>/
      <session>/
        state.json                   # Current session state
        log.jsonl                    # Append-only event history
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
