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
3. Register the bertrand MCP server in Claude Code's settings
4. Write `~/.bertrand/config.yaml`
5. Install Wave widget config (if Wave detected)

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

## MCP Server

Bertrand includes an MCP server that gives Claude sessions on-demand access to data from other sessions. After running `bertrand init`, the server is automatically registered in Claude Code's settings.

### How it works

The MCP server runs over stdio — Claude Code spawns it as a child process. The current session name flows via the `BERTRAND_SESSION` environment variable, which bertrand already sets on every Claude process.

### Resources

| URI | Description |
|-----|-------------|
| `bertrand://siblings` | Sibling sessions in the same project/ticket scope |
| `bertrand://sessions` | All sessions (optional `?project` filter) |
| `bertrand://sessions/{name}/digest` | Full digest: timeline, timing, counts |
| `bertrand://sessions/{name}/events` | Raw events (optional `?last=N`) |
| `bertrand://sessions/{name}/state` | Current status, summary, worktree |

### Tools

| Tool | Description |
|------|-------------|
| `search_events` | Search events across sessions by type, time range, or session |
| `session_summary` | Focused summary of any session with recent activity and PRs |

### Standalone usage

```sh
bertrand mcp
```

Starts the MCP server over stdio. Useful for testing or integrating with other MCP clients.

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

Releases are fully automated via [release-please](https://github.com/googleapis/release-please) and [goreleaser](https://goreleaser.com/).

### How it works

1. **Write conventional commits** — prefix your PR titles with `feat:`, `fix:`, `refactor:`, etc. (enforced by CI)
2. **Merge to main** — release-please automatically opens or updates a "Release" PR with a generated changelog and version bump
3. **Merge the Release PR** — release-please creates a `v*` tag, which triggers goreleaser to build Darwin binaries (amd64 + arm64), create a GitHub release, and update the [Homebrew tap](https://github.com/uiid-systems/homebrew-bertrand)

Users get the update via:

```sh
brew upgrade bertrand
```

### Commit prefixes

| Prefix | Bump | Changelog section |
|--------|------|-------------------|
| `feat:` | minor | Features |
| `fix:` | patch | Bug Fixes |
| `perf:` | patch | Performance |
| `refactor:` | patch | Refactoring |
| `feat!:` / `BREAKING CHANGE:` | major | Breaking Changes |
| `docs:`, `chore:`, `test:`, `ci:` | — | hidden |

### Manual release (escape hatch)

If you need to bypass the automated flow:

```sh
bertrand release           # patch bump (default)
bertrand release --minor   # minor bump
bertrand release --dry-run # preview without releasing
```

## License

MIT
