/**
 * Best-effort connection from the CLI process that owns a session's PTY to
 * `bertrand serve`'s terminal relay (src/server/terminal-relay.ts), so a
 * dashboard browser can watch and drive the same PTY the local terminal is
 * attached to. See docs/pty-wrapper.md. Never blocks or throws — if the
 * server isn't reachable, the local terminal keeps working exactly as
 * before; the browser side just has nothing to attach to.
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

export function connectTerminalRelay(opts: ConnectTerminalRelayOptions): TerminalRelayClient {
  const port = Number(process.env.BERTRAND_PORT ?? 5200);
  const url = `ws://127.0.0.1:${port}/ws/sessions/${opts.sessionId}/terminal?role=upstream`;

  let socket: WebSocket | null;
  // Geometry is known before the socket finishes connecting, so hold the most
  // recent value and flush it on open rather than silently dropping it.
  let pendingDims: { cols: number; rows: number } | null = null;

  try {
    socket = new WebSocket(url);
  } catch {
    socket = null;
  }

  if (socket) {
    const ws = socket;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (!pendingDims) return;
      ws.send(JSON.stringify({ t: "dims", ...pendingDims }));
      pendingDims = null;
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
    ws.onerror = () => {
      socket = null;
    };
  }

  return {
    send(chunk) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(chunk);
    },
    sendDims(cols, rows) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: "dims", cols, rows }));
      } else {
        pendingDims = { cols, rows };
      }
    },
    close() {
      socket?.close();
      socket = null;
    },
  };
}
