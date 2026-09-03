# bertrand

Multi-session workflow logger for Claude Code. Tracks concurrent Claude Code sessions, captures their timelines into a local database, and surfaces them in a dashboard for review.

## How it works

Bertrand wraps Claude Code with two pieces:

1. **A system-prompt contract** that tells the agent to call `AskUserQuestion` every turn with concrete, actionable options.
2. **Claude Code hooks** that observe tool calls and lifecycle events (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `PermissionRequest`) and write structured events into a local SQLite database.

The agent never knows bertrand exists. Hooks fire, scripts call `bertrand update`, rows land in the DB, the dashboard reads them.

When a session calls `AskUserQuestion`, bertrand marks it `waiting`. When you answer, the session moves back to `active`.

## Prerequisites

- **[Claude Code](https://code.claude.com/docs/en/overview)** — `--append-system-prompt` and hooks support required.
- **[Bun](https://bun.sh/)** ≥ 1.3 — runtime for bertrand and the dashboard.

## Install

```sh
bun i -g bertrand    # or: npm i -g bertrand
```

The first run of `bertrand` auto-runs `init`; you can also invoke `bertrand init` explicitly.

### From source

```sh
git clone https://github.com/uiid-systems/bertrand.git
cd bertrand
bun install
bun run src/index.ts init
```

Invoke via `bun run src/index.ts <command>` while developing.

## Setup

```sh
bertrand init
```

This:

1. Creates `~/.bertrand/` with `config.json` and `bertrand.db`.
2. Installs hook scripts to `~/.bertrand/hooks/`.
3. Registers them in `~/.claude/settings.json`.
4. Installs the `/bertrand` slash command to `~/.claude/commands/bertrand.md`.
5. Writes shell completions to `~/.bertrand/completions/`.

Re-run `init` whenever bertrand updates — hook scripts are versioned and may need refreshing.

## Usage

### Launch a new session

```sh
bertrand
```

Opens a TUI to name a session (e.g. `fix-recap-render`, `ENG-142-auth`) or pick up a paused one, rolled up by the repo it ran in. Sessions are flat — a name may contain slashes, but they are part of the name, not a hierarchy; grouping comes from the repo and branch of the directory you launch in. Claude Code launches with the bertrand contract applied, and the session ends by returning you to the shell.

### Attach a session you didn't launch through bertrand

If Claude Code is already running — you opened it directly, or an ADE like orca
spawned it — type:

```
/bertrand
```

That records the conversation so far, starts capturing the rest of it, and applies the contract from that turn on. Pass work along with it (`/bertrand fix the flaky test`) and the session starts on it immediately.

`bertrand adopt` is the same thing without the slash command, for a terminal you're already in.

An attached session goes in unnamed and is named from its own transcript at the first pause, exactly like a launched one. Bertrand ends it when Claude Code exits — there's no bertrand process watching an attached session, so that happens on the next `bertrand` launch or dashboard start rather than instantly.

Resuming one (`claude --resume`) picks up where it left off, but only once you run `/bertrand` again: attaching leaves a marker keyed to the conversation, and ending the session clears it. The second `/bertrand` re-attaches to the same session — same name, same timeline — and back-fills anything said in between. Archived sessions are the exception; those stay closed.

### Resume

```sh
bertrand <group/session>
```

Shows a picker: start a fresh Claude conversation, or resume one of the prior conversations on this session. Either way, bertrand re-injects the session timeline and any sibling-session context.

### List

```sh
bertrand list
```

Interactive picker showing all sessions with status badges. Add `--project <slug>` to list sessions from another project without switching the active one.

### Other commands

| Command | Purpose |
|---|---|
| `bertrand log` | List sessions in the active project. Add `--project <slug>` to scope to a different project. |
| `bertrand log <session>` | Print the timeline event log for a session. Supports `--json` (includes `project: { slug, name }` for agent consumption) and `--project <slug>` for cross-project reads. |
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
- **`events`** — every hook firing and lifecycle moment (`session.waiting`, `session.answered`, `tool.applied`, `context.snapshot`, etc.). Free-form `meta` JSON column.
- **`session_stats`** — materialized stats, refreshed at session end.
- **`worktree_associations`** — tracked worktree branches per session.

Stats are computed live for `active`/`waiting` sessions and read from the materialized row otherwise — see [`src/server/index.ts`](src/server/index.ts).

`src/engine` and `src/tui` — the PTY relay and the launcher UI — are **optional**. Recording a session needs only the hooks, the database and the CLI, which is why `bertrand adopt` can pick up a `claude` that bertrand never started. Nothing on the recording path may import either directory; the two are reached through `await import(…)` from `bertrand launch` and the dashboard's session routes, and [`src/layer-boundary.test.ts`](src/layer-boundary.test.ts) fails if that changes.

## File layout

### Repo

```
src/
  cli/         # Command router and command handlers
  contract/    # System-prompt contract (AskUserQuestion loop, sibling context)
  db/          # Drizzle schema, migrations, query functions
  engine/      # Optional launcher: the PTY relay `bertrand launch` runs Claude under
  hooks/       # Hook script generation (bash templates)
  lib/         # Session lifecycle (finalize, recovery), timing FSM, diff stats, formatting
  server/      # Bun HTTP server (/api/*)
  tui/         # Optional launcher: Storm TUI screens
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
  config.json                     # bertrand settings
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

## Releasing

Releases are driven by [release-please](https://github.com/googleapis/release-please) from conventional commits on `main`.

1. Land commits in conventional format (`feat:`, `fix:`, `refactor:`, etc.). Hidden types — `chore`, `docs`, `test`, `ci` — don't trigger a release.
2. The `Release Please` workflow opens or updates a release PR with the next version + `CHANGELOG.md` entries.
3. Merging the release PR creates the git tag and a GitHub Release.
4. The same workflow then publishes to npm with provenance (typecheck + tests run first).

The `.release-please-manifest.json` file tracks the last released version; release-please updates it automatically. Publishing relies on the `NPM_TOKEN` repo secret (npm Automation token).

## License

MIT
