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

Or build from source:

```sh
git clone https://github.com/uiid-systems/bertrand.git
cd bertrand
bun install
bun run src/index.ts init
```

## Setup

Run the setup wizard:

```sh
bertrand init
```

This will:

1. Install hook scripts to `~/.bertrand/hooks/`
2. Configure Claude Code hooks in `~/.claude/settings.json`
3. Write `~/.bertrand/config.json`
4. Generate shell completions to `~/.bertrand/completions/`

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

## File Layout

### Runtime state (`~/.bertrand/`)

```
~/.bertrand/
  config.json                        # Terminal + bertrand settings
  bertrand.db                        # SQLite database (sessions, events, stats)
  hooks/
    on-waiting.sh                    # PreToolUse AskUserQuestion → session.waiting
    on-answered.sh                   # PostToolUse AskUserQuestion → session.answered
    on-active.sh                     # PreToolUse catch-all → session.active
    on-permission-wait.sh            # PermissionRequest → permission.request
    on-permission-done.sh            # PostToolUse catch-all → permission.resolve
    on-done.sh                       # Stop → session.paused
  completions/                       # Shell completion scripts
```

## License

MIT
