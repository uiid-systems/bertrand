/**
 * Best-effort connection from the CLI process that owns a session's PTY to
 * `bertrand serve`'s terminal relay (src/server/terminal-relay.ts), so a
 * dashboard browser can watch and drive the same PTY the local terminal is
 * attached to. See docs/pty-wrapper.md. Never blocks or throws — if the
 * server isn't reachable, the local terminal keeps working exactly as
 * before; the browser side just has nothing to attach to.
 */
export interface TerminalRelayClient {
  send(chunk: Uint8Array): void;
  close(): void;
}

export interface ConnectTerminalRelayOptions {
  sessionId: string;
  onInput: (chunk: Uint8Array) => void;
  onResize: (cols: number, rows: number) => void;
}

export function connectTerminalRelay(opts: ConnectTerminalRelayOptions): TerminalRelayClient {
  const port = Number(process.env.BERTRAND_PORT ?? 5200);
  const url = `ws://127.0.0.1:${port}/ws/sessions/${opts.sessionId}/terminal?role=upstream`;

  let socket: WebSocket | null;
  try {
    socket = new WebSocket(url);
  } catch {
    socket = null;
  }

  if (socket) {
    const ws = socket;
    ws.binaryType = "arraybuffer";
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const parsed = JSON.parse(event.data);
          if (typeof parsed?.cols === "number" && typeof parsed?.rows === "number") {
            opts.onResize(parsed.cols, parsed.rows);
          }
        } catch {
          // Ignore malformed control frames rather than crashing the session.
        }
      } else {
        opts.onInput(new Uint8Array(event.data as ArrayBuffer));
      }
    };
    ws.onerror = () => {
      socket = null;
    };
  }

  return {
    send(chunk) {
      if (socket?.readyState === WebSocket.OPEN) socket.send(chunk);
    },
    close() {
      socket?.close();
      socket = null;
    },
  };
}
