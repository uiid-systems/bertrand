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
 *   - `{t:"dims",cols,rows}` — upstream reports the geometry of the terminal
 *     it is attached to. The relay remembers it and forwards it to browsers so
 *     they can size their emulator to match. The local terminal owns the
 *     geometry; browsers deliberately cannot resize the PTY (see `message`).
 *   - `{t:"repaint"}` — relay asks upstream to force a full redraw, sent when
 *     a browser attaches partway through a session.
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

export type TerminalControlFrame =
  | { t: "dims"; cols: number; rows: number }
  | { t: "repaint" };

/**
 * How much recent PTY output to replay to an attaching browser. Enough to
 * carry useful scrollback, small enough that idle sessions don't accumulate
 * meaningful memory in a long-lived `bertrand serve`.
 */
const REPLAY_LIMIT_BYTES = 256 * 1024;

interface SessionState {
  /** Recent PTY output, oldest chunk first, trimmed to REPLAY_LIMIT_BYTES. */
  chunks: Uint8Array[];
  bytes: number;
  /** Geometry last reported by upstream, or null if it hasn't reported yet. */
  cols: number | null;
  rows: number | null;
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
    state = { chunks: [], bytes: 0, cols: null, rows: null };
    sessions.set(sessionId, state);
  }
  return state;
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
      parsed?.t === "dims" &&
      typeof parsed.cols === "number" &&
      typeof parsed.rows === "number"
    ) {
      return { t: "dims", cols: parsed.cols, rows: parsed.rows };
    }
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

    // Browser. Only raw keystrokes are honoured. Control frames from a browser
    // are dropped on purpose: the local terminal owns the PTY geometry, so
    // letting a browser resize it would reflow and corrupt the terminal the
    // session is actually attached to.
    if (typeof message === "string") return;
    ws.publish(inputTopic(sessionId), message);
  },

  close(ws: ServerWebSocket<TerminalSocketData>) {
    // The PTY is gone once the process that owns it disconnects, so its
    // replayable history is worthless — drop it instead of letting state
    // accumulate for every session a long-lived server has ever seen.
    if (ws.data.role === "upstream") sessions.delete(ws.data.sessionId);
  },
};
