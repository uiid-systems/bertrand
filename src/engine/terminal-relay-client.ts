/**
 * Best-effort connection from the CLI process that owns a session's PTY to
 * `bertrand serve`'s terminal relay (src/server/terminal-relay.ts), so a
 * dashboard browser can watch and drive the same PTY the local terminal is
 * attached to. See docs/pty-wrapper.md. Never blocks or throws — if the
 * server isn't reachable, the local terminal keeps working exactly as
 * before; the browser side just has nothing to attach to.
 *
 * This side owns the PTY geometry: it reports its dimensions via `sendDims`
 * and browsers size their emulator to match. Browsers cannot resize the PTY,
 * so there is no `onResize` — the only thing the relay asks of this side is a
 * repaint when a browser attaches mid-session.
 */
export interface TerminalRelayClient {
  send(chunk: Uint8Array): void;
  /** Reports the local terminal's geometry so attaching browsers can match it. */
  sendDims(cols: number, rows: number): void;
  close(): void;
}

export interface ConnectTerminalRelayOptions {
  sessionId: string;
  onInput: (chunk: Uint8Array) => void;
  /** A browser attached mid-session and needs the current screen redrawn. */
  onRepaint: () => void;
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
          if (JSON.parse(event.data)?.t === "repaint") opts.onRepaint();
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
