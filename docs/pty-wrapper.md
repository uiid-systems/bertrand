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
really attached to). The cost, accepted deliberately: the local terminal reflows to the
smaller grid while a dashboard panel is attached, and springs back when it detaches.

A browser's `{t:"dims"}` frame is still ignored — reporting the PTY's real size remains
upstream's job, so a browser cannot spoof it, only ask.

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

- Should a session be startable *headlessly* (server-spawned, no local terminal ever
  attached), or does v1 only mirror a session a real terminal already started? The fan
  in/out design above works either way, but it changes where `launchClaude()` gets
  called from.
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
