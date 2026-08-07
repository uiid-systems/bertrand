/**
 * Best-effort connection from the CLI process that owns a session's PTY to
 * `bertrand serve`'s terminal relay (src/server/terminal-relay.ts), so a
 * dashboard browser can watch and drive the same PTY the local terminal is
 * attached to. See docs/pty-wrapper.md. Never blocks or throws — if the
 * server isn't reachable, the local terminal keeps working exactly as
 * before; the browser side just has nothing to attach to.
 *
 * The connection is retried for the life of the session rather than attempted
 * once. Two situations make a single attempt insufficient, and both leave the
 * dashboard terminal permanently blank for a session that is otherwise healthy:
 *
 *   - **Cold start.** `ensureServerStarted` spawns `bertrand serve` detached,
 *     and a session begins moments later — routinely before a fresh Bun process
 *     has bound the port. The first attempt is refused by a server that is on
 *     its way up.
 *   - **The server restarting mid-session**, including the user upgrading
 *     bertrand underneath a running session.
 *
 * Backoff runs from eager to idle, so a server coming up is caught almost
 * immediately while a machine that never runs the dashboard costs one refused
 * connection every few seconds.
 *
 * This side remains the authority on PTY geometry: it reports the size it
 * actually applied via `sendDims`, and browsers size their emulator to match.
 * A browser renders at a fixed font size, so the grid it can display is a
 * function of its panel; it sends that as a claim, which the relay aggregates
 * and forwards here as `onSetSize`. That is a *request*, and this side decides
 * what to do with it (see src/engine/process.ts, which takes the smaller of the
 * claim and the local terminal so neither view is asked to display more than it
 * can show).
 */
export interface TerminalRelayClient {
  send(chunk: Uint8Array): void;
  /** Reports the geometry actually applied to the PTY so browsers can match it. */
  sendDims(cols: number, rows: number): void;
  /**
   * Tells attached browsers the session's process has exited, so they can show
   * an ended state instead of a terminal that looks live. Send it *before*
   * `close()` — browsers keep their sockets when upstream disconnects, so this
   * is the only notice they get.
   */
  sendEnded(exitCode: number): void;
  /**
   * Resolves once the connection has settled — either open, or unreachable for
   * long enough that a caller shouldn't keep waiting on it. Output bytes handed
   * to `send` before that are dropped rather than queued (a browser that hasn't
   * attached must never block the terminal), so anything that needs its first
   * bytes to actually arrive should await this. Never rejects, and always
   * settles: the relay is best-effort, and a caller awaiting it must not be
   * taken down — or held open — by the server being absent. Reconnects continue
   * after it settles, so this resolving unreachable is not a final answer.
   */
  readonly ready: Promise<void>;
  close(): void;
}

export interface ConnectTerminalRelayOptions {
  sessionId: string;
  onInput: (chunk: Uint8Array) => void;
  /** A browser attached mid-session and needs the current screen redrawn. */
  onRepaint: () => void;
  /**
   * Browsers want the PTY at this size, or null when no browser is claiming one
   * and the local terminal's own size should apply again.
   */
  onSetSize: (dims: { cols: number; rows: number } | null) => void;
}

/**
 * How long to keep trying before `ready` settles unreachable. Comfortably
 * covers a cold `bertrand serve` binding its port, so the common case settles
 * by opening rather than by timing out.
 */
const READY_GRACE_MS = 3_000;

/** Backoff between connection attempts, from eager to idle. */
const MIN_RETRY_MS = 100;
const MAX_RETRY_MS = 5_000;

export function connectTerminalRelay(opts: ConnectTerminalRelayOptions): TerminalRelayClient {
  const port = Number(process.env.BERTRAND_PORT ?? 5200);
  const url = `ws://127.0.0.1:${port}/ws/sessions/${opts.sessionId}/terminal?role=upstream`;

  /** The open connection, or null while there isn't one. */
  let socket: WebSocket | null = null;
  /** Set by `close()`; stops the retry loop from resurrecting the connection. */
  let done = false;
  let retryDelay = MIN_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The geometry last applied to the PTY. Held indefinitely rather than cleared
   * once sent, because the relay forgets the size when upstream disconnects
   * (see terminal-relay.ts's close handler) — a reconnecting client has to
   * re-report it or attached browsers have no dims to size themselves to.
   */
  let lastDims: { cols: number; rows: number } | null = null;

  let settle: () => void;
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const readyTimer = setTimeout(() => settle(), READY_GRACE_MS);
  readyTimer.unref?.();
  const markReady = () => {
    clearTimeout(readyTimer);
    settle();
  };

  const scheduleRetry = () => {
    // One pending attempt at a time: a failure surfaces as `onerror` *and*
    // `onclose`, which would otherwise queue two.
    if (done || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryDelay);
    retryTimer.unref?.();
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  };

  function connect(): void {
    if (done) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleRetry();
      return;
    }
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      if (done) {
        ws.close();
        return;
      }
      socket = ws;
      retryDelay = MIN_RETRY_MS;
      markReady();
      // Re-report geometry on every open, not just when a send was pending:
      // after a reconnect the relay has no record of the PTY's size.
      if (lastDims) ws.send(JSON.stringify({ t: "dims", ...lastDims }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const frame = JSON.parse(event.data);
          if (frame?.t === "repaint") opts.onRepaint();
          else if (frame?.t === "setsize") {
            opts.onSetSize(
              typeof frame.cols === "number" && typeof frame.rows === "number"
                ? { cols: frame.cols, rows: frame.rows }
                : null,
            );
          }
        } catch {
          // Ignore malformed control frames rather than crashing the session.
        }
        return;
      }
      opts.onInput(new Uint8Array(event.data as ArrayBuffer));
    };

    // A refused connection reports both; `onclose` always follows, so leave the
    // rescheduling to it and keep this handler purely about not throwing.
    ws.onerror = () => {};

    ws.onclose = () => {
      if (socket === ws) socket = null;
      scheduleRetry();
    };
  }

  connect();

  return {
    ready,
    send(chunk) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(chunk);
    },
    sendDims(cols, rows) {
      lastDims = { cols, rows };
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "dims", cols, rows }));
      }
    },
    sendEnded(exitCode) {
      // Best-effort and deliberately not queued for a reconnect: if the socket
      // is down at exit there is no session left to reattach to, and a browser
      // in that situation learns from the session row instead.
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "ended", exitCode }));
      }
    },
    close() {
      done = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      clearTimeout(readyTimer);
      settle();
      socket?.close();
      socket = null;
    },
  };
}
