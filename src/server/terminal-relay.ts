import type { Server, ServerWebSocket } from "bun";

/**
 * Relays a session's PTY between the CLI process that owns it (role
 * "upstream", see src/engine/process.ts) and any number of dashboard
 * browsers (role "browser") — see docs/pty-wrapper.md. Uses Bun's built-in
 * pub/sub topics instead of a hand-rolled connection registry: upstream
 * subscribes to the input topic and publishes to the output topic; browsers
 * do the reverse.
 *
 * Binary frames are raw PTY bytes in both directions. Text frames are JSON
 * control frames:
 *
 *   - `{t:"dims",cols,rows}` — upstream reports the geometry of the PTY. The
 *     relay remembers it and forwards it to browsers so they can size their
 *     emulator to match. Only upstream may report dims; a `dims` frame from a
 *     browser is ignored, so a browser can never spoof the PTY's real size.
 *   - `{t:"claim",cols,rows}` — a browser asks for the PTY to be sized to its
 *     own viewport ("take over"). The relay tracks one claim per browser and
 *     forwards the smallest across all claims upstream, tmux's
 *     smallest-attached-client rule: every attached view then renders a frame
 *     it can actually display in full.
 *   - `{t:"unclaim"}` — a browser drops its claim (also implied by
 *     disconnecting).
 *   - `{t:"setsize",cols,rows}` — relay tells upstream the size browsers are
 *     asking for; `cols`/`rows` are `null` when no claim is outstanding, which
 *     means "go back to your own terminal's size".
 *   - `{t:"repaint"}` — relay asks upstream to force a full redraw, sent when
 *     a browser attaches partway through a session.
 *
 * Geometry is negotiated rather than owned outright, but upstream stays the
 * single source of truth: a claim is only a *request*, and browsers learn the
 * result from the `dims` frame upstream sends after it actually resizes the
 * PTY. See docs/pty-wrapper.md.
 *
 * The relay keeps a small amount of per-session state so that a browser
 * attaching to an already-running session sees the current screen rather than
 * a blank one: the recent output is replayed on attach, then a repaint is
 * requested so the TUI redraws a clean frame on top of it.
 */

export type TerminalRole = "upstream" | "browser";

export interface TerminalSocketData {
  sessionId: string;
  role: TerminalRole;
}

export interface TerminalDims {
  cols: number;
  rows: number;
}

export type TerminalControlFrame =
  | { t: "dims"; cols: number; rows: number }
  | { t: "claim"; cols: number; rows: number }
  | { t: "unclaim" }
  | { t: "setsize"; cols: number | null; rows: number | null }
  | { t: "repaint" };

/**
 * How much recent PTY output to replay to an attaching browser. Enough to
 * carry useful scrollback, small enough that idle sessions don't accumulate
 * meaningful memory in a long-lived `bertrand serve`.
 */
const REPLAY_LIMIT_BYTES = 256 * 1024;

/**
 * Bounds on a browser's geometry claim. A claim resizes a real PTY, so a
 * malformed or hostile frame shouldn't be able to wedge the session at 1x1 or
 * balloon it — anything outside these bounds is dropped rather than clamped, so
 * a nonsense claim is simply ignored instead of silently becoming a resize.
 */
const CLAIM_BOUNDS = { minCols: 20, maxCols: 1000, minRows: 5, maxRows: 300 };

interface SessionState {
  /** Recent PTY output, oldest chunk first, trimmed to REPLAY_LIMIT_BYTES. */
  chunks: Uint8Array[];
  bytes: number;
  /** Geometry last reported by upstream, or null if it hasn't reported yet. */
  cols: number | null;
  rows: number | null;
  /**
   * The connection that owns the PTY, held so control frames can be delivered
   * to it from any trigger — a browser's claim, a browser disconnecting, or
   * upstream reconnecting to outstanding claims. Input *bytes* still flow over
   * the pub/sub topic; this is only for the control channel, where
   * publish-from-self and publish-from-a-closing-socket aren't dependable.
   */
  upstream: ServerWebSocket<TerminalSocketData> | null;
  /**
   * One geometry claim per browser, being the grid its viewport can display at
   * its (fixed) font size. A browser that hasn't measured its box yet — one
   * whose terminal panel is collapsed, say — has no entry here.
   */
  claims: Map<ServerWebSocket<TerminalSocketData>, TerminalDims>;
}

const sessions = new Map<string, SessionState>();

const TERMINAL_WS_PATH = /^\/ws\/sessions\/([^/]+)\/terminal$/;

function outputTopic(sessionId: string): string {
  return `terminal:${sessionId}:output`;
}

function inputTopic(sessionId: string): string {
  return `terminal:${sessionId}:input`;
}

function stateFor(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = {
      chunks: [],
      bytes: 0,
      cols: null,
      rows: null,
      upstream: null,
      claims: new Map(),
    };
    sessions.set(sessionId, state);
  }
  return state;
}

/**
 * The geometry to ask upstream for: the smallest of every outstanding browser
 * claim, or null when nothing is claimed. Taking the minimum per axis (rather
 * than the smallest client's pair) means no attached browser is ever asked to
 * display more than it has room for.
 */
function effectiveClaim(state: SessionState): TerminalDims | null {
  let cols: number | null = null;
  let rows: number | null = null;
  for (const claim of state.claims.values()) {
    cols = cols === null ? claim.cols : Math.min(cols, claim.cols);
    rows = rows === null ? claim.rows : Math.min(rows, claim.rows);
  }
  return cols === null || rows === null ? null : { cols, rows };
}

/**
 * Tells upstream what size browsers want. Called whenever the set of claims
 * changes — a claim, an unclaim, a browser disconnecting, or upstream
 * reconnecting while claims are already outstanding.
 */
function pushSize(state: SessionState): void {
  if (!state.upstream) return;
  const claim = effectiveClaim(state);
  state.upstream.send(
    JSON.stringify({
      t: "setsize",
      cols: claim?.cols ?? null,
      rows: claim?.rows ?? null,
    }),
  );
}

function isClaimable({ cols, rows }: TerminalDims): boolean {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= CLAIM_BOUNDS.minCols &&
    cols <= CLAIM_BOUNDS.maxCols &&
    rows >= CLAIM_BOUNDS.minRows &&
    rows <= CLAIM_BOUNDS.maxRows
  );
}

/**
 * Appends a chunk to the replay buffer, dropping the oldest chunks once the
 * byte cap is exceeded. Copies the bytes because Bun may reuse the buffer
 * backing a websocket message after the handler returns.
 */
function remember(state: SessionState, message: Buffer): void {
  state.chunks.push(new Uint8Array(message));
  state.bytes += message.byteLength;
  while (state.bytes > REPLAY_LIMIT_BYTES && state.chunks.length > 0) {
    const dropped = state.chunks.shift();
    if (!dropped) break;
    state.bytes -= dropped.byteLength;
  }
}

function parseControlFrame(raw: string): TerminalControlFrame | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      (parsed?.t === "dims" || parsed?.t === "claim") &&
      typeof parsed.cols === "number" &&
      typeof parsed.rows === "number"
    ) {
      return { t: parsed.t, cols: parsed.cols, rows: parsed.rows };
    }
    if (parsed?.t === "unclaim") return { t: "unclaim" };
    if (parsed?.t === "repaint") return { t: "repaint" };
    return null;
  } catch {
    // Ignore malformed control frames rather than tearing down the relay.
    return null;
  }
}

/**
 * If `url` matches the terminal websocket path, attempts the upgrade and
 * returns the Response the caller's `fetch` should return (`undefined` on
 * success — Bun has already sent the 101 response). Returns `false` if the
 * path didn't match at all, so the caller can fall through to normal
 * routing.
 */
export function tryUpgradeTerminal(
  req: Request,
  server: Server<TerminalSocketData>,
  url: URL,
): Response | undefined | false {
  const match = TERMINAL_WS_PATH.exec(url.pathname);
  if (!match) return false;

  const sessionId = match[1]!;
  const role: TerminalRole =
    url.searchParams.get("role") === "upstream" ? "upstream" : "browser";
  const upgraded = server.upgrade(req, { data: { sessionId, role } });
  return upgraded ? undefined : new Response("Upgrade failed", { status: 400 });
}

export const terminalWebSocketHandlers = {
  open(ws: ServerWebSocket<TerminalSocketData>) {
    const { sessionId, role } = ws.data;

    if (role === "upstream") {
      ws.subscribe(inputTopic(sessionId));
      // A session can outlive a relay connection (server restart, upstream
      // reconnect). If browsers are still holding claims, tell the new upstream
      // about them straight away rather than waiting for the next resize.
      const state = stateFor(sessionId);
      state.upstream = ws;
      if (state.claims.size > 0) pushSize(state);
      return;
    }

    ws.subscribe(outputTopic(sessionId));

    // Bring the newly attached browser up to date. Order matters: geometry
    // first so the emulator is the right size before any bytes land, then the
    // recent output, then a repaint request so a mid-session attach ends on a
    // clean frame rather than whatever partial redraw it happened to catch.
    const state = stateFor(sessionId);
    if (state.cols !== null && state.rows !== null) {
      ws.send(JSON.stringify({ t: "dims", cols: state.cols, rows: state.rows }));
    }
    for (const chunk of state.chunks) ws.send(chunk);
    ws.publish(inputTopic(sessionId), JSON.stringify({ t: "repaint" }));
  },

  message(ws: ServerWebSocket<TerminalSocketData>, message: string | Buffer) {
    const { sessionId, role } = ws.data;

    if (role === "upstream") {
      if (typeof message === "string") {
        const frame = parseControlFrame(message);
        if (!frame || frame.t !== "dims") return;
        const state = stateFor(sessionId);
        state.cols = frame.cols;
        state.rows = frame.rows;
        ws.publish(outputTopic(sessionId), message);
        return;
      }
      remember(stateFor(sessionId), message);
      ws.publish(outputTopic(sessionId), message);
      return;
    }

    // Browser. Raw keystrokes pass straight through; of the control frames only
    // claim/unclaim are honoured. A browser's `dims` frame is still ignored —
    // reporting the PTY's real size is upstream's job, and a browser that wants
    // a different size has to claim one, which is negotiated and reversible.
    if (typeof message !== "string") {
      ws.publish(inputTopic(sessionId), message);
      return;
    }

    const frame = parseControlFrame(message);
    if (!frame) return;
    const state = stateFor(sessionId);

    if (frame.t === "claim") {
      if (!isClaimable(frame)) return;
      const previous = state.claims.get(ws);
      if (previous?.cols === frame.cols && previous?.rows === frame.rows) return;
      state.claims.set(ws, { cols: frame.cols, rows: frame.rows });
      pushSize(state);
      return;
    }

    if (frame.t === "unclaim") {
      if (!state.claims.delete(ws)) return;
      pushSize(state);
    }
  },

  close(ws: ServerWebSocket<TerminalSocketData>) {
    const { sessionId, role } = ws.data;
    const state = sessions.get(sessionId);
    if (!state) return;

    if (role === "browser") {
      // Disconnecting implies unclaim: a closed tab must not keep the PTY
      // pinned to the size of a window nobody is looking at.
      if (state.claims.delete(ws)) pushSize(state);
      return;
    }

    // The PTY is gone once the process that owns it disconnects, so its
    // replayable history is worthless — drop it instead of letting state
    // accumulate for every session a long-lived server has ever seen. Claims
    // outlive it, so a browser that is still attached keeps its take-over if
    // upstream reconnects.
    state.upstream = null;
    state.chunks = [];
    state.bytes = 0;
    state.cols = null;
    state.rows = null;
    if (state.claims.size === 0) sessions.delete(sessionId);
  },
};
