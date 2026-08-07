# Browser ↔ Terminal Control (PTY wrapper)

**Status:** v1 built and tested end-to-end; wired into the dashboard's session view
**Date:** 2026-08-04
**Owner:** Adam

## Progress log

- **2026-08-04** — Design written from a spike session (`spike/pty-wrapper`) surveying
  how other tools let a browser control a live CLI-agent session, and scoping the
  smallest version that fits bertrand's current architecture.
- **2026-08-04 (later)** — **v1 built** (PTY swap in
  [d7d45b3](https://github.com/uiid-systems/bertrand/commit/d7d45b3); relay layer
  below in a follow-up commit): `src/engine/pty.ts` (the `spawnPty()` primitive over
  Bun's native PTY), `launchClaude()` swapped from `stdio: "inherit"` to it, and the
  websocket relay resolving the "different processes" open question below —
  `src/server/terminal-relay.ts` (Bun pub/sub topics: `terminal:<id>:input`/`:output`,
  no hand-rolled registry needed) plus `src/engine/terminal-relay-client.ts` (the CLI
  process connects out to the already-running `bertrand serve` as a websocket client,
  role `upstream`; a browser connects as role `browser`). Verified end-to-end in
  `src/engine/pty-relay-integration.test.ts`: a real `Bun.serve` + `spawnPty` + both
  relay sides, `cat` standing in for `claude` — local-terminal-equivalent input and
  browser input both land on the same PTY and echo back out to the browser,
  proving the interchangeability goal. Real interactive smoke test also done by hand
  (`bun dev`, created a session, exited with Ctrl+C) confirming the raw-mode/SIGINT
  behavior change noted in `src/engine/process.ts` is fine in practice.
  The dashboard side now exists too: `dashboard/src/routes/dev/terminal.tsx` renders a
  live session's PTY with **xterm.js** (`@xterm/xterm`, the one new dependency this
  design anticipated) and drives it from `term.onData`.

  **Why an emulator, not a `<pre>`:** the first cut of that page dumped raw PTY bytes
  into a `<pre>` and the result was unreadable, in a way worth recording because it
  looks like data corruption and isn't. A TUI redraws in place, so (a) CSS treats `\r`
  as a line break, turning every in-place spinner redraw into a new line, and (b) TUIs
  advance the cursor with `ESC[nC` instead of writing literal spaces, and those
  sequences are inert in HTML — so words ran together (`i'msendingyouthis…`). Bytes over
  the relay were byte-perfect the whole time; only the rendering was wrong. A second
  bug in the same page: its "send" button appended `\n`, but Enter on a raw-mode tty is
  `\r` (0x0D) — Claude Code's composer treats `\n` as "insert a newline", so input
  landed in the prompt and never submitted. `term.onData` emits tty-correct bytes and
  removes that whole class of hand-rolled key translation.

- **2026-08-04 (later still)** — **geometry reworked and the terminal given a real home
  in the dashboard.** Sizing the emulator to the local terminal's grid made the dev page
  unusable in a browser, so geometry became negotiated (see the superseded section
  below) and the terminal became a portable, container-driven component:
  `dashboard/src/components/terminal/` (`SessionTerminal` + `geometry.ts`), fixed font
  size, ResizeObserver on its own box, claim debounced by 120ms. It is embedded in the
  session view via a new collapsible main-area zone shell
  (`dashboard/src/components/content-zone/`, the counterpart to `SidebarZone`): a
  vertical split of Timeline over Terminal, both collapsible to their trigger bar, with
  "maximize" implemented as collapsing the timeline. Collapse state is persisted
  (`useZoneCollapse`) because expanding the terminal attaches to a live PTY.
  `routes/dev/terminal.tsx` is now a harness over the same component with a frame picker
  (panel / drawer / sidebar / mobile / tall) to check it reflows into any box.
  Deliberately *not* persisted across navigation: several sessions can be live at once,
  so a terminal that outlived its route would show a different session's PTY than the
  timeline beside it.

- **2026-08-04 (later again)** — **the zones stopped being a split, and sizing authority
  started following the reader.** The main area's two zones are now flex items in one
  full-height column rather than panels of a vertical `Resizable`: collapse state lived
  both in `useZoneCollapse` and in the panel group's internal sizing, and the effects
  syncing them fought `onResize`, so a collapsed zone often failed to hand its space
  over. Sizing a zone from `open` alone removed the second source of truth (and the
  drag). The timeline also stopped unmounting when collapsed — it renders every prompt
  and reply through `Markdown`, so rebuilding it was O(events) parses and a visible stall
  on expand; it now hides behind `display: none` (`keepMounted`), while the terminal
  keeps unmounting because that is what detaches its PTY. Separately, a claim is no
  longer held for the whole time a panel is attached — see *Sizing authority follows the
  reader* below.

### Geometry: negotiated, smallest attached view wins

**Superseded 2026-08-04.** The first cut made the local terminal the sole owner of
geometry: upstream reported `{t:"dims"}` and browsers sized their emulator to match,
with browser control frames dropped. That is unusable in a dashboard panel. The PTY's
grid comes from a *different window*, so the emulator can never be the size of its
container — and the invariant every working xterm embed depends on (parent is an
explicitly-sized box, `cols`/`rows` match that box, `.xterm-viewport` is the only
scroller) is unreachable. What you get instead is `.xterm-screen` sized to
`cols × cellWidth` overflowing the absolutely-positioned viewport that was supposed to
clip it, nested inside three other scroll containers.

Scaling the font to letterbox the PTY's grid into the panel was tried and rejected:
it holds the geometry constant but doesn't behave like a terminal. **A terminal's font
size is fixed; resizing the window changes how many rows and columns fit, and the
attached program reflows.** Reflowing means resizing the PTY, so the browser has to be
able to drive geometry.

So geometry is negotiated with tmux's smallest-attached-client rule:

- A browser renders at a **fixed** font size and sends the grid its panel fits as
  `{t:"claim",cols,rows}` (debounced, so dragging a panel resizes the PTY once at the
  end rather than once per column).
- The relay tracks one claim per browser and forwards the smallest across all of them,
  per axis, as `{t:"setsize"}`. Disconnecting implies unclaim.
- `launchClaude()` applies `smallestDims(localTerminal, claim)` (`src/engine/pty.ts`)
  and reports what actually took effect as `{t:"dims"}`.

Upstream therefore stays the single source of truth — a claim is a request, `dims` is
the answer — which is what keeps the two sides honest. Taking the minimum per axis
means no attached view is ever sent a frame it has to truncate: the larger view gets
unused margin, which is harmless, and a browser can never force the PTY *wider* than
the local terminal's window (which would wrap output in the terminal the session is
really attached to). The cost: the local terminal reflows to the smaller grid while a
dashboard panel holds a claim — which is why a claim is no longer held for as long as the
panel is attached (below).

A browser's `{t:"dims"}` frame is still ignored — reporting the PTY's real size remains
upstream's job, so a browser cannot spoof it, only ask.

### Sizing authority follows the reader

Smallest-attached-client is the right rule and still leaves a real problem: a dashboard
panel and a terminal window are rarely the same size, so one of them is always rendering
into unused margin, and which one changes as windows move. Neither fixed answer is
acceptable — always claiming caps a wide terminal window to a narrow panel, and never
claiming leaves the panel displaying a grid far too big for it (fitting a fullscreen
230×60 grid into a ~980×400 panel needs a ~7px font, below the readable floor).

So the claim is held only while the dashboard page is actually being read — visible *and*
focused — and handed back when the reader looks away
(`dashboard/src/components/terminal/use-sizing-authority.ts`). Switch to the terminal and
it gets its whole window back; switch to the dashboard and the panel fits exactly.

What makes this cheap is that **the released state is never seen**: nobody is reading a
page they have switched away from, so an oversized grid only has to be corrected before
it becomes visible again, which regaining focus does immediately rather than on the
claim debounce. No font scaling or horizontal scrolling is needed to present a grid that
doesn't fit, because it is only ever too big while unwatched.

Two details that are easy to get wrong:

- The resize path must be **gated** on holding authority. Releasing makes upstream report
  the local terminal's grid, which arrives at the browser as a resize — so an ungated
  resize handler re-claims and undoes the release immediately.
- Releasing is sent whenever a claim is outstanding, without checking whether it is
  currently the binding one. `applyDims()` resizes to `min(local, claim)` and `TIOCSWINSZ`
  only raises `SIGWINCH` when the size actually changes, so releasing a non-binding claim
  costs nothing — while skipping it would leave a stale claim behind to cap the terminal
  if its window is grown while nobody is watching the dashboard.

Handing back is delayed (400ms) so that passing over the dashboard doesn't resize the PTY
twice; taking authority is immediate, because that transition is the one someone is
looking at.

### Attach replay

The relay keeps a bounded per-session ring buffer (256KB) of recent output, because it
is otherwise stateless pub/sub — a browser attaching to an already-running session
received nothing until the next byte and showed a blank screen. On attach the relay
sends known geometry, replays the buffer, then publishes `{t:"repaint"}` upstream;
`launchClaude()` answers it by resizing the PTY twice in quick succession, which reads
as a real terminal resize and makes the TUI repaint a full clean frame over the
replayed scrollback. The buffer is discarded when upstream disconnects, so a
long-lived `bertrand serve` doesn't accumulate history for dead sessions.

**Wire protocol summary** — binary frames are raw PTY bytes in both directions; text
frames are JSON control frames:

| Frame | Direction | Meaning |
| --- | --- | --- |
| `{t:"dims",cols,rows}` | upstream → relay → browsers | geometry actually applied to the PTY; browsers render it |
| `{t:"claim",cols,rows}` | browser → relay | grid this browser's panel fits; out-of-bounds claims are dropped |
| `{t:"unclaim"}` | browser → relay | drop this browser's claim (also implied by disconnecting) |
| `{t:"setsize",cols,rows}` | relay → upstream | smallest claim across browsers; `null`/`null` means "use your own size" |
| `{t:"repaint"}` | relay → upstream | a browser attached mid-session; redraw everything |
| *(binary)* | either direction | raw PTY bytes |

## Goal

Let a bertrand session's live Claude Code terminal be driven from the dashboard
(browser) and from a real local terminal **interchangeably** — either one can read
output and send input to the same running session. No remote access, no auth, no
reconnect/scrollback-restore yet; those are explicitly deferred (see below).

Note: "terminal-agnostic" (#161) is unrelated — that removed *terminal-app*
detection/badging (Wave, Warp). This doc is about the PTY (the pseudo-terminal device
Claude Code runs inside), a different layer entirely.

## Prior art surveyed

Two reference projects, both initially misidentified by name and confirmed by reading
actual source:

- **`conductor-oss`** (real project: [charannyk06/conductor-oss](https://github.com/charannyk06/conductor-oss),
  homepage conductross.com — *not* [conductor-oss/conductor](https://github.com/conductor-oss/conductor),
  which is Netflix's unrelated workflow-orchestration engine). Rust/Axum backend that
  spawns `ttyd` per session and proxies its websocket framing
  (see their [`terminal-frame-protocol.md`](https://github.com/charannyk06/conductor-oss/blob/main/docs/terminal-frame-protocol.md)),
  adding auth tokens, an ANSI restore-snapshot for reconnect, and a relay server +
  Go bridge daemon for paired-device/remote access (outbound-only connection to the
  relay, ngrok-style, so a browser elsewhere can reach a terminal behind NAT).
  Pragmatic: reuse a mature C tool for the actual PTY bridging, build session/auth/relay
  around it.
- **Orca** ([stablyai/orca](https://github.com/stablyai/orca), onorca.dev). Much larger
  custom build: `node-pty` + `xterm.js` (WebGL renderer) directly, its own binary frame
  protocol (batched/chunked, heavily benchmarked), a custom relay for mobile/remote, and
  a subscribe/pause/resume "input lease" model so a desktop browser and a mobile WebView
  can both watch one PTY while only one holds input at a time. Large investment in edge
  cases (IME input, Windows apphang, Wayland, restart-preserving scrollback).

Decision: follow Orca's direction (own the PTY directly, no external binary dependency)
but build only the minimal slice — no relay, no lease model, no restore snapshot yet.

## Background: the current seam

`src/engine/process.ts` spawns Claude Code today with Node's `child_process.spawn` and
`stdio: "inherit"` — the local terminal's file descriptors are handed straight to the
child process. Bertrand itself is not in the data path at all; there is nothing to
attach a browser to.

Bun ships a native PTY API (`Bun.spawn`'s `terminal` option / `new Bun.Terminal()`),
landed in Bun 1.3.5, POSIX-only. Confirmed present on this machine (Bun 1.3.14):
`Bun.spawn(["bash"], { terminal: { cols, rows, data(terminal, chunk) {...} } })`,
`proc.terminal.write(chunk)`, `proc.terminal.resize(cols, rows)`. This replaces the need
for `node-pty` (or any of the `bun-pty` third-party FFI wrappers) — no native module
build step, no extra dependency.

## Decisions

### 1. Bertrand becomes the PTY host, not a passthrough

Replace the `child_process.spawn(..., { stdio: "inherit" })` call in
`launchClaude()` with `Bun.spawn(["claude", ...args], { terminal: {...} })`. Bertrand's
own process now owns the PTY; local terminal attachment becomes just one consumer of it
instead of the only one.

### 2. One fan-out point, one fan-in point — that's what makes it interchangeable

- **Output (fan-out):** the `terminal.data()` callback is the single place PTY output
  arrives. It writes to local `process.stdout` when bertrand is attached to a real
  terminal, and broadcasts the same bytes to any connected dashboard websocket. Same
  chunk, no per-consumer branching.
- **Input (fan-in):** local raw-mode stdin and websocket input messages both just call
  `proc.terminal.write()`. Resize events (local `process.stdout` resize, or a message
  from the browser) both just call `proc.terminal.resize()`.
- No lease/arbitration for v1 — single user, so last-keystroke-wins is acceptable.
  Revisit only if simultaneous multi-device input (not just either/or) becomes a real
  want; that's the problem Orca's lease model solves.

### 3. Reuse the existing server, don't stand up a new one

Bertrand already runs a long-lived Bun server (`bertrand serve`, `src/server`,
`server-lifecycle.ts`) and a Vite dashboard that already renders a per-session view.
Add one websocket route to the existing server (e.g. per-session terminal stream); add
one `xterm.js` component to the dashboard wired to it. No new daemon, no new deps beyond
`xterm` in `dashboard/package.json`.

### Dashboard-owned sessions (designed, not built)

Tracked in [issue #207](https://github.com/uiid-systems/bertrand/issues/207).

Every geometry compromise in this document exists for one reason: **two viewers**. The
minimum is taken because a frame has to be displayable in both, the authority handover
exists because they're rarely the same size, and the residual dead margin is unfixable
because the PTY can never be wider than the local terminal's window without wrapping
output in the terminal the session is really attached to.

A session *created from the dashboard* has one viewer. There is no local terminal to take
a minimum against, so the browser's claim is the only input and the grid is exactly the
panel's — always, at any size, with no margin, no handover, and no font scaling. The
sizing problem doesn't get solved so much as it stops existing.

This is deliberately **not** a replacement for the shared model. Both live on the same
relay, and the only thing that differs is who owns the PTY:

| | PTY spawned by | `local` dims | Geometry |
| --- | --- | --- | --- |
| CLI-started (today) | the `bertrand` CLI process | the real tty | `min(local, claim)`, authority follows the reader |
| Dashboard-created | `bertrand serve` | none | the claim, outright |

Most of the machinery already exists and is untouched by this: the relay and its
`upstream`/`browser` roles, attach replay, input fan-in, `dims` reporting. Hooks fire
from `claude`'s own settings regardless of who spawned it (and `BERTRAND_CLAUDE_ID` is
already passed through the environment), so the timeline populates identically — a
dashboard-created session is a normal session in every view.

The session's cwd, however, is not simply supplied by `src/lib/workspace/`:
`resolveWorkspace(dir)` resolves *preview-server* run config for a directory, while the
cwd itself comes from `session.worktreePath` — a DB column `src/` only ever reads. There
is no worktree *creation* path in the codebase, so a dashboard-created session that needs
a fresh worktree does not have one waiting for it.

What is actually new:

- **A spawn path in the server.** `spawnPty` called from `bertrand serve` rather than from
  `launchClaude()`. The dims policy gains the mirror of the case it already handles:
  `smallestDims` returns `local` when the claim is null, and needs to return the claim
  when there is no local terminal. Before any browser has claimed, the conventional 80×24
  stands in. Both cwd and env must be passed explicitly — `emitClaudeStarted({ cwd:
  process.cwd() })` inside serve would otherwise record the server's inherited cwd, which
  has nothing to do with the session.
- **Per-session state that is currently process-global.** The state that makes a session a
  session lives above `launchClaude()`, in `src/engine/session.ts`, and all of it assumes
  one session per process: `activePty` and `isClaudeRunning()` (`src/engine/process.ts`),
  `liveSession`, and the exit handlers that finalize *the* live session. A server hosting
  N sessions needs each of these keyed by session ID. This is a refactor of `session.ts`,
  not a new spawn path bolted beside it.
- **Server-owned lifetime.** Resolved by spike (see issue #209). A server-spawned PTY
  outlives every *viewer* — closing the browser tab does not end the session — but it does
  **not** outlive `bertrand serve`. `Bun.spawn({ terminal })` keeps the PTY master in the
  serve process and the child is never detached, so `claude` runs as a session leader with
  a controlling terminal (`STAT Ss+`); when serve dies the master closes and the kernel
  SIGHUPs it. Confirmed on both SIGTERM and SIGKILL, children included.

  Two consequences. There are no orphaned processes to reap, so the #175 file registry has
  no job here — what leaked was the session *row*, left `active` with a dead pid and no end
  time. And **adopting a live session across a serve restart is impossible**: the master fd
  died with the old process, so even a surviving `claude` would be unreachable. Real
  adoption would need a genuinely detached, reattachable PTY (setsid plus a durable
  transport) — a much larger change, unbuilt.

  What shipped instead: `sessions.pid_started_at` records when the pid was claimed, and
  `lib/process-identity.ts` verifies it against the observed process start (now − `etime`)
  so a *recycled* pid can't pass as the original — otherwise recovery's `kill(pid, 0)`
  reads the recycled number as alive and the row is never reconciled. `startServer()` runs
  that reconciliation on boot, through the same `finalizeSessionRow` a clean exit uses.
  The identity helpers are shared with #175 rather than duplicated; its group-leader check
  is opt-in, because session pids are not reliably group leaders (the CLI records its own
  `process.pid`, which does not lead the group inside a pipeline) and requiring it there
  would reap live sessions.

  Two specifics that still hold: `session.pid` is the PTY's pid, not the serve daemon's
  (point it at serve and every crashed session looks alive forever, while restarting serve
  mass-pauses all of them), and `stopServerIfIdle()` would be a self-SIGTERM when finalize
  runs inside serve — both the dashboard exit path and boot recovery pass
  `stopServerWhenIdle: false`. Concurrent server-owned sessions are capped
  (`BERTRAND_MAX_DASHBOARD_SESSIONS`, default 8); the endpoint answers 503 at capacity.
- **Credentials for a daemon-spawned `claude`.** Resolved by spike (see issue #207): a
  detached, no-tty, `stdio:"ignore"` `claude` authenticates against the macOS login
  keychain without prompting. The one requirement is `USER` in the environment — without
  it the process cannot resolve the keychain and reports `Not logged in · Please run
  /login`, which misreads as expired auth. The spawn path must construct an explicit env
  rather than inherit one, and fail loudly on a missing `USER`.

Multiple browser tabs on one dashboard-created session still negotiate `min()` across
their claims — which is correct, and unlike the terminal case it's fixable by closing a
tab.

## Explicitly deferred

- **Reconnect / scrollback-restore snapshot** — replaying output after a dropped
  websocket. Both reference projects invested heavily here; skip for v1, revisit once
  the basic loop works.
- **Remote access via `bertrand.sh`** — raised as a "consider down the line" idea: since
  bertrand is browser-based already, there's a plausible path to reaching a session's
  terminal from `bertrand.sh` itself, not just `localhost`. This is a **different axis**
  from the existing `docs/workspaces.md` `*.local.bertrand.sh` design — that doc solves
  "a nicer URL for a loopback preview," not "reach my machine from elsewhere." Actual
  remote reachability needs the relay + bridge-daemon pattern both conductor-oss and
  Orca built (outbound-only connection from the local machine to a relay, so no inbound
  port-forwarding/NAT traversal is required) — and needs auth, which is explicitly not
  happening yet. Not designed further here.
- **Multi-writer arbitration beyond last-wins.**

## Open questions

- ~~Should a session be startable *headlessly* (server-spawned, no local terminal ever
  attached), or does v1 only mirror a session a real terminal already started?~~
  **Answered: both, and the geometry work is what makes it worth doing** (not yet built —
  see *Dashboard-owned sessions* below).
- ~~Where does per-session PTY state live if the CLI process and the server process are
  different processes?~~ **Resolved**: kept `launchClaude()` spawning the PTY in the CLI
  process (no change to how sessions start) and had it connect *out* to the
  already-running `bertrand serve` as an ordinary websocket client (role `upstream`),
  symmetric with a browser client (role `browser`). The server just relays between
  whoever's subscribed via Bun's pub/sub topics — no shared memory, no new registry.
  This is the same shape conductor-oss/Orca use for remote access (an outbound-only
  connection to a relay), just at localhost scope for now.

## References

- [charannyk06/conductor-oss](https://github.com/charannyk06/conductor-oss) —
  ttyd-wrap + relay/bridge architecture
- [stablyai/orca](https://github.com/stablyai/orca) — custom node-pty + xterm.js,
  frame protocol, input-lease model
- [Bun v1.3.5 release notes](https://bun.com/blog/bun-v1.3.5) — native PTY API
- `docs/workspaces.md` — related but distinct: loopback preview URLs, not remote
  terminal access
