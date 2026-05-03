# bertrand

Multi-session workflow manager for Claude Code. Tracks concurrent Claude Code sessions, captures their timelines into a local database, and surfaces them in a dashboard for review.

> **Status:** TypeScript rebuild. The previous Go release (v0.9.1) is still on Homebrew but no longer developed against this branch.

## How it works

Bertrand wraps Claude Code with two pieces:

1. **A system-prompt contract** that tells the agent to call `AskUserQuestion` every turn with concrete, actionable options.
2. **Claude Code hooks** that observe tool calls and lifecycle events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PermissionRequest`) and write structured events into a local SQLite database.

The agent never knows bertrand exists. Hooks fire, scripts call `bertrand update`, rows land in the DB, the dashboard reads them.

When a session calls `AskUserQuestion`, bertrand marks it `waiting`, sets a Wave Terminal badge, and sends a notification. When you answer, the badge clears and the session moves to `active`.

## Prerequisites

- **[Claude Code](https://code.claude.com/docs/en/overview)** — `--append-system-prompt` and hooks support required.
- **[Bun](https://bun.sh/)** ≥ 1.3 — runtime for bertrand and the dashboard.
- **[Wave Terminal](https://www.waveterm.dev/)** — optional, but the only supported terminal for badges/notifications. Without it, bertrand still tracks state; you just don't get focus management.

## Install (from source)

```sh
git clone https://github.com/uiid-systems/bertrand.git
cd bertrand
bun install
bun run src/index.ts init
```

Then add `~/.bertrand/bin` (or wherever `init` writes the launcher) to your `PATH`, or invoke `bun run src/index.ts <command>` directly.

## Setup

```sh
bertrand init
```

This:

1. Creates `~/.bertrand/` with `config.json` and `bertrand.db`.
2. Installs hook scripts to `~/.bertrand/hooks/`.
3. Registers them in `~/.claude/settings.json`.
4. Writes shell completions to `~/.bertrand/completions/`.

Re-run `init` whenever bertrand updates — hook scripts are versioned and may need refreshing.

## Usage

### Launch a new session

```sh
bertrand
```

Opens an Ink TUI to type a session name (e.g. `bertrand/fix-recap-render`, `frontend/ENG-142-auth`). Slashes nest the session under group folders. Claude Code launches with the bertrand contract applied.

### Resume

```sh
bertrand <group/session>
```

Shows a picker: start a fresh Claude conversation, or resume one of the prior conversations on this session. Either way, bertrand re-injects the session timeline and any sibling-session context.

### List

```sh
bertrand list
```

Interactive picker showing all sessions with status badges.

### Other commands

| Command | Purpose |
|---|---|
| `bertrand log <session>` | Print the timeline event log for a session. |
| `bertrand stats <session>` | Print materialized stats (duration, work/wait split, lines changed). |
| `bertrand archive <name>` | Archive or unarchive a session. |
| `bertrand serve` | Start the dashboard HTTP API on `:5200`. |
| `bertrand backfill-stats` | Re-compute stats for older sessions after schema changes. |
| `bertrand update` | Hook-facing event writer. Internal — don't call directly. |

## Dashboard

A Vite + React + TanStack Router app at `dashboard/`. Renders timelines (assistant text, thinking, code diffs, permissions, Q&A pairs, context snapshots), engagement stats, and a session sidebar.

Run both the API and the dev server:

```sh
cd dashboard
bun run dev
```

This spawns `bertrand serve` (API on `:5200`) and `vite` (dashboard on `:5199`). Visit [http://localhost:5199](http://localhost:5199). The dashboard proxies `/api` to `:5200`.

> The dashboard is currently dev-mode only. There's no production build/serve path yet.

## Session states

| Status | Meaning |
|---|---|
| `active` | Agent is generating a response. |
| `waiting` | Agent called `AskUserQuestion`, blocked on user input. |
| `paused` | Session ended (Claude Code exited). |
| `archived` | Manually archived; hidden from default views. |

## Focus management (Wave)

When a session enters `waiting`, hooks call `wsh badge` to mark the block tab and `wsh notify` to send a notification. When it returns to `active`, the badge clears.

Other terminals fall back to no-ops; the session state is still tracked.

## Architecture

```
Claude Code hook  →  ~/.bertrand/hooks/*.sh  →  `bertrand update --event …`  →  SQLite (events table)
                                                                                       ↓
                                                                             /api/events/:sessionId
                                                                                       ↓
                                                                              dashboard timeline
```

Key tables ([`src/db/schema.ts`](src/db/schema.ts)):

- **`groups`** — nestable session containers.
- **`sessions`** — named workspaces, status-tracked.
- **`conversations`** — Claude conversations within a session (claude_id UUIDs).
- **`events`** — every hook firing and lifecycle moment (`session.waiting`, `session.answered`, `tool.applied`, `context.snapshot`, `session.recap`, etc.). Free-form `meta` JSON column.
- **`session_stats`** — materialized stats, refreshed at session end.
- **`worktree_associations`** — tracked worktree branches per session.

Stats are computed live for `active`/`waiting` sessions and read from the materialized row otherwise — see [`src/server/index.ts`](src/server/index.ts).

## File layout

### Repo

```
src/
  cli/         # Command router and command handlers
  contract/    # System-prompt contract (AskUserQuestion loop, sibling context)
  db/          # Drizzle schema, migrations, query functions
  engine/      # Session lifecycle (launch, resume, finalize)
  hooks/       # Hook script generation (bash templates)
  lib/         # Timing FSM, diff stats, engagement, formatting, tests
  server/      # Bun HTTP server (/api/*)
  terminal/    # Terminal adapters (Wave, Noop)
  tui/         # Ink-based TUI screens
dashboard/
  src/
    api/         # Typed TanStack Query hooks
    components/  # Timeline content renderers, sidebar, markdown
    lib/         # Event categories, transforms, formatting
    routes/      # TanStack Router pages
schema/        # Drizzle migration SQL
```

### Runtime

```
~/.bertrand/
  config.json                     # Terminal + bertrand settings
  bertrand.db                     # SQLite (sessions, events, stats)
  hooks/
    on-waiting.sh                 # PreToolUse AskUserQuestion → session.waiting
    on-answered.sh                # PostToolUse AskUserQuestion → session.answered
    on-active.sh                  # PreToolUse catch-all → session.active
    on-permission-wait.sh         # PermissionRequest → permission.request
    on-permission-done.sh         # PostToolUse catch-all → permission.resolve
    on-user-prompt.sh             # UserPromptSubmit → user.prompt
    on-done.sh                    # Stop → session.paused
  completions/                    # Shell completion scripts
```

## Development

```sh
bun run typecheck       # Type-check src/
bun test                # Run backend tests
bun run db:generate     # Generate Drizzle migration after schema change
bun run db:migrate      # Apply migrations to ~/.bertrand/bertrand.db
```

The dashboard has its own `tsc -b` typecheck — run from `dashboard/`.

## License

MIT
