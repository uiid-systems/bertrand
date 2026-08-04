# Browser ↔ Terminal Control (PTY wrapper)

**Status:** v1 built and tested end-to-end; not yet wired to a real dashboard UI
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

### Geometry: the local terminal owns it

Input is symmetric (local terminal and browser both just `pty.write()`); **size is
deliberately not**. Upstream reports its dimensions as a `{t:"dims",cols,rows}` control
frame and browsers resize their emulator to match; the relay drops control frames sent
by a browser. Letting a browser resize the PTY would reflow and visibly corrupt the
terminal the session is actually attached to, and with several consumers attached
last-writer-wins is unpredictable. (tmux's smallest-of-all-consumers rule is the more
general answer if multiple *interactive* consumers ever need it; not needed while the
local terminal is the one true attachment.)

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
| `{t:"dims",cols,rows}` | upstream → relay → browsers | local terminal's geometry; browsers match it |
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
