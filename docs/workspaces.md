# Workspaces & Live Preview

**Status:** Design / proposed
**Date:** 2026-06-23
**Owner:** Adam

## Goal

Make it frictionless to run many bertrand sessions at once by giving each one an
isolated git worktree *and* a live, running environment you can open without ever
`cd`-ing into the worktree directory. The headline pain this kills: as a frontend
engineer, parallelism is worthless if you can't see each branch running. Today that
means hunting for the right `localhost:PORT` in the right terminal. We want a stable,
self-documenting URL per session, surfaced in one place.

## Background: this is unbuilt, not failed

It's worth being precise about history, because it changes the framing:

- The **Go era** shipped the whole feature set: `feat: on-demand worktree preview with
  Portless` (#62), a dashboard worktrees tab with per-file diff stats (e38343b, #56),
  and `cleanup`/`review` commands (#46, #48).
- The **TypeScript rebuild** (#73) carried over the `worktree_associations` *table* in
  the initial schema but never wired up `src/lib/git.ts` — the worktree helpers
  (`listWorktrees`/`createWorktree`/`removeWorktree`) exist and are unused.
- **#135** ("prune dead timeline events, columns, and renderers") then dropped the
  unused table (migration `0006`).

So worktree-first is **prior art we proved once and haven't re-implemented in TS** — not
an experiment that failed. We get to rebuild it deliberately, and this time solve the
dev-server problem from day one so there is never a reason to skip a worktree.

## Decisions

These three were decided directly; rationale captured for posterity.

### 1. Lazy / intent-triggered worktrees (not eager)

A session does **not** create a worktree at launch. It enters one when work becomes
*git-bound* (commits, branches, PRs). This reaffirms the existing `worktree-defaults`
philosophy: we don't ask up front because sessions evolve organically — a chat turns
into code, or a "I'll fix this" turns out to need no changes at all. Committing to a
worktree at launch would be wrong about half the time.

Implication for this design: **the preview system must be able to come into existence
mid-session**, the moment a worktree is created — not only at launch. That's the
natural shape anyway (lazy server start), so it costs us nothing.

Note this does not weaken the "run more at once" goal. The sessions that benefit from
isolation are exactly the ones modifying code; those are precisely the ones that trip
the git-bound trigger and get a worktree + preview. Pure-chat sessions don't need
isolation and don't pay for it.

### 2. Bertrand owns the reverse proxy (we don't depend on Portless)

[Portless](https://github.com/vercel-labs/portless) is the reference implementation of
the idea — a local HTTPS proxy that routes `branch.app.localhost` to per-worktree dev
servers on ephemeral ports. We will build the equivalent in-house rather than depend on
it, because (a) maintenance risk of an external single-maintainer tool, and (b) owning
the proxy lets us integrate it tightly with the dashboard (live logs, status, one
process to manage) and with bertrand's existing session lifecycle.

We already run a long-lived server (`bertrand serve`, `:5200`, managed by
`src/lib/server-lifecycle.ts` with a PID file). The proxy is an extension of that
machinery, not a new daemon to babysit.

### 3. Brand the URLs on our own domain (`*.local.bertrand.sh`), not `.localhost`

Using `bertrand.sh` instead of `.localhost` is a **good** idea, with one caveat about
*how*. The upside of owning the domain is real: we can serve genuinely valid TLS for
`*.local.bertrand.sh`, so previews are `https://…` with no browser warning and no
"trust this cert" dance — strictly better DX than Portless's self-signed local CA. The
URL is also branded and self-documenting (`myfeature.bertrand.local.bertrand.sh`).

The caveat is in the TLS *mechanism* — see "Hard parts" below. Short version: own the
**domain**, but mint the **certs locally** rather than shipping a real private key.

## How it works

### Routing: host-based, not path-based

The proxy routes on the **Host header**:
`https://<session-slug>.<project>.local.bertrand.sh` → look up the dev-server port
registered for that session → forward to `127.0.0.1:<ephemeral>` (including WebSocket
upgrades, which HMR/Vite/Next fast-refresh depend on).

This must be host/subdomain-based, **not** a path prefix on `:5200`
(`localhost:5200/preview/<session>/`). Frontend dev servers assume they live at root
`/`: absolute asset paths (`/static/...`), router `basePath`, HMR websocket URLs, and
cookies all break under a path prefix unless the app is specifically configured for it.
Subdomain routing keeps the app thinking it's at `/`. This is the entire reason Portless
uses subdomains, and we inherit the same constraint.

### Worktree lifecycle (lazy)

1. **Entry** — triggered by git-bound intent (per `worktree-defaults`). Reuse
   `src/lib/git.ts` `createWorktree`. A `PostToolUse` hook on `EnterWorktree` records
   the worktree path against the session (marker file + `worktree.entered` event), the
   pattern `src/hooks/runtime.ts` already uses.
2. **Setup** — run the project's setup step: install/symlink dependencies, symlink
   `.env`. (Conductor's model — see below.)
3. **Register** — allocate a deterministic port for the session and register the
   `session → port` mapping with the proxy. Add the `/etc/hosts` entry (offline path)
   and/or rely on wildcard DNS (online path).
4. **Run** — start the dev server (the project's `run` command) as a managed detached
   process with a PID file, the same way `server-lifecycle.ts` starts `bertrand serve`.
   Eager-on-entry by default (simpler than holding requests during a cold boot).
5. **Exit / merge** — run `archive`, kill the dev server, remove the `/etc/hosts`
   entry, prune markers. A safety-net `on-worktree-exited` hook kills any lingering
   server.

### Setup / run / archive (borrowed from Conductor)

Conductor's genuinely good idea is a small, declarative lifecycle — not its GUI:

- **setup script** runs on every new workspace; handles everything git doesn't track
  (`pnpm install`, `ln -s "$ROOT/.env" .env`).
- **run script** launches the app/dev server (e.g. `next dev --port $PORT`).
- **archive script** tears down.
- Plus env conventions: a per-workspace **port block** (`CONDUCTOR_PORT`..`+9`) and a
  `CONDUCTOR_WORKSPACE_NAME` for naming per-workspace resources.

We adopt the same three-verb lifecycle and inject equivalent env into both the setup and
run commands:

- `BERTRAND_PORT` (+ a small reserved block, e.g. `+0..+9`, for apps that need several)
- `BERTRAND_WORKSPACE` (the session/worktree slug, for naming DB files, data dirs, etc.)
- `BERTRAND_ROOT` (the main checkout path, for symlinking shared files)
- `BERTRAND_PREVIEW_URL` (the stable URL, exported so the app/logs can print it)

**Where this config lives.** The global `~/.bertrand/config.json` (`BertrandConfig`) is
per-machine and wrong for this — the dev command is a property of the *project* and
should be shared/versioned with the team. Proposal:

- **Default: zero-config.** Auto-detect the dev command from `package.json` `scripts.dev`
  + lockfile. This covers the frontend 80% with no setup.
- **Override: repo-committed.** A `bertrand` key in `package.json` or a `.bertrand/`
  file in the repo for `setup` / `run` / `archive` / `devCommand`. Repo-committed so a
  teammate cloning the project inherits it (Conductor stores team scripts in
  `.conductor/` for the same reason).

### Surfacing it (the "no cd" payoff)

The whole point is that you never touch the worktree directory. Bertrand `cd`s for you
and hands you a link:

- **Dashboard worktrees panel** — revive the pruned tab (e38343b): every active session
  with a worktree, its live preview URL (click to open), start/stop, and tailed logs.
  This is the command center for "run more at once."
- **TUI** — show the preview URL per active session.
- **`bertrand open <session>`** — new command; opens the preview URL in the browser and
  lazily starts the server if it isn't running. (No `open`/`preview` command exists
  today — closest is `serve`.)

## Hard parts: DNS and TLS

Getting to a clean `https://session.project.local.bertrand.sh` with **no port** and **no
cert warning** forces three things, each with a cost. This is the part worth thinking
hard about.

### Clean URL ⇒ privileged port

A URL with no `:port` means the proxy binds `:443` (or `:80`) — privileged ports that
need root on macOS/Linux. Portless solves this with a one-time root-owned
launchd/systemd service (`portless service install`). We'd do the same: a small
privileged helper installed once at `bertrand init`. The no-sudo alternative is a
high-port URL (`…local.bertrand.sh:5200`), which reintroduces the port we were trying to
hide. Recommendation: **high-port HTTP first (Phase 1, no sudo), privileged `:443`
helper later (Phase 2)** for the real endgame.

### Resolution: how `*.local.bertrand.sh` points at loopback

Two viable mechanisms; we can ship both:

| Mechanism | Pros | Cons |
|---|---|---|
| **Public wildcard DNS** (`*.local.bertrand.sh A 127.0.0.1`, like `lvh.me`/`sslip.io`) | Zero local config; works for every user with no sudo | Needs a DNS lookup → **fails offline** (plane, no network) |
| **Managed `/etc/hosts`** (bertrand adds a line per active preview, removes on stop) | Works **offline**; bounded to active sessions | Needs the privileged helper (no wildcard in `/etc/hosts`, so one line per preview) |

Since the privileged helper already exists for `:443`, having it also manage `/etc/hosts`
is nearly free and removes the offline concern entirely. Recommendation: **public
wildcard DNS as the primary zero-friction path; `/etc/hosts` management via the helper as
the offline fallback.**

### TLS: own the domain, but mint certs locally

This is the precise answer to "is `bertrand.sh` a bad idea?" — the domain is great; just
don't ship a real cert's private key.

- **Tempting but avoid: ship a real Let's Encrypt `*.local.bertrand.sh` cert** (issued
  via DNS-01 since we control the domain). Genuinely valid HTTPS, but: the private key
  baked into a distributed binary is extractable by anyone; a leaked CT-logged key can be
  flagged/revoked by the CA and break *every* user until we re-ship; and the 90-day
  renewal forces the binary to phone home or re-release constantly. The blast radius of a
  leak is small (the cert only ever serves `127.0.0.1`), but the operational fragility is
  not worth it.
- **Recommended: per-machine local CA (mkcert-style).** Generate a CA on the user's
  machine on first run, add it to the system trust store, and mint `*.local.bertrand.sh`
  leaf certs locally. No shipped secret, no renewal treadmill, no phone-home. Cost: a
  one-time "trust this CA" step (automatable, needs sudo once — same escalation we
  already need for `:443`/`/etc/hosts`).

Net: **own the domain** (branded, resolvable, can be backed by valid TLS) and **mint the
certs locally** (no distributed secret). DNS resolution and TLS trust are independent
concerns — local CA handles trust, wildcard DNS or `/etc/hosts` handles resolution.

## What we reuse

This is cheap to build because most of the parts exist or have prior art:

| Piece | Status |
|---|---|
| `src/lib/git.ts` — worktree create/list/remove | Written, unused — ready to wire |
| `src/lib/server-lifecycle.ts` — detached process + PID file | Template for per-preview dev-server management |
| `src/server/index.ts` — the `:5200` server | Extend to reverse-proxy (or add privileged sibling) |
| `src/hooks/` + `hooks/runtime.ts` markers | Track worktree/preview state |
| `src/lib/projects/` registry | Per-project config + path resolution |
| Dashboard worktrees panel (e38343b, pruned) | Revive |
| Contract / template system | Inject worktree-first behavior (designed in `worktree-defaults`) |

## Scope: what's isolated in v1

Worktrees give *code* isolation. Full parity needs *runtime* isolation, which has rings
([runtime-isolation argument](https://www.penligent.ai/hackinglabs/git-worktrees-need-runtime-isolation-for-parallel-ai-agent-development/)).
We deliberately do the frontend-critical inner rings and leave the rest to convention:

- **In scope (v1):** code (worktree), dependencies (setup: install or symlink
  `node_modules`), secrets (`.env` symlink), ports/URL (the proxy).
- **Out of scope (v1), offer conventions not enforcement:** databases (suggest a
  per-worktree DB file keyed by `BERTRAND_WORKSPACE`, or shared-by-default), caches,
  auth/browser/cookie state, background services, Docker. Do **not** build a container
  orchestrator — that's the over-engineering trap for a frontend workflow.

## Open questions / risks

- **Privilege UX** — one-time sudo at `init` for `:443` + local CA + `/etc/hosts`.
  Acceptable, or keep a fully no-sudo high-port mode as a first-class option?
- **Monorepo / multi-app** — a worktree with web + api needs two subdomains
  (`web.feature.…`, `api.feature.…`). The config and proxy must support multiple named
  apps per worktree (Portless does this via app names).
- **Auto-start policy** — eager-on-entry (simpler) vs lazy-on-first-request (the proxy
  must hold the request during cold boot). Leaning eager-on-entry, or eager-on-first-
  dashboard-open.
- **Port allocation** — deterministic per session; need a strategy for collisions and
  for sessions that outlive their slot. `prune` for orphans.
- **Lazy-trigger reliability** — bertrand learns a worktree exists via the
  `EnterWorktree` hook; confirm that fires for both agent- and user-initiated entry.

## Phased rollout

- **Phase 0 — visibility.** Wire `lib/git.ts` + the `EnterWorktree` hook so a session
  tracks its worktree (marker + event + DB). Show active worktrees in the dashboard
  again. No dev servers yet.
- **Phase 1 — preview, no sudo.** Per-worktree dev server (auto-detected `dev` command),
  deterministic port, HTTP reverse proxy on a high port, URL surfaced in dashboard +
  `bertrand open`. URL still has a port — acceptable interim. Proves the flow end-to-end.
- **Phase 2 — the endgame.** Privileged helper: clean `:443` URLs, local-CA valid HTTPS,
  `/etc/hosts` management, `*.local.bertrand.sh` branding. No port, no warning, no cd.
- **Phase 3 — breadth.** Monorepo/multi-app, archive scripts, richer isolation
  conventions (per-worktree DB).

## References

- [Conductor — setup/run/archive scripts](https://www.conductor.build/docs/reference/scripts/setup)
- [Conductor — environment variables](https://www.conductor.build/docs/reference/environment-variables)
- [Portless](https://github.com/vercel-labs/portless)
- [Portless + Conductor + worktrees recipe](https://community.vercel.com/t/using-portless-with-conductor-git-worktrees/34557)
- [Git worktrees need runtime isolation](https://www.penligent.ai/hackinglabs/git-worktrees-need-runtime-isolation-for-parallel-ai-agent-development/)
