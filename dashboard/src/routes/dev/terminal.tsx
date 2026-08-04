import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, Card, Group, Stack, Text } from "@uiid/design-system";
import { Terminal } from "@xterm/xterm";
import type { IDisposable } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { wsUrl } from "../../api/base";
import { useAllSessions } from "../../lib/use-sessions";

const LIVE_STATUSES = new Set(["active", "waiting", "blocked"]);

/** Keeps a tall PTY from pushing the rest of the page off-screen. */
const MAX_FRAME_HEIGHT = 720;

/**
 * Drives a live session's PTY from the browser over
 * `/ws/sessions/:id/terminal?role=browser` (src/server/terminal-relay.ts).
 *
 * Output goes through xterm.js rather than a `<pre>`: the PTY emits ANSI, and
 * a TUI like Claude Code redraws in place with carriage returns and cursor
 * movement. Rendering those bytes as text produces garbage — CSS treats `\r`
 * as a line break, so in-place redraws stack up vertically, and cursor-forward
 * sequences (which TUIs emit instead of literal spaces) vanish, running words
 * together. Only a terminal emulator can interpret them.
 *
 * Input comes from `term.onData`, which already emits exactly what a tty would
 * — CR for Enter, `\x03` for Ctrl+C, escape sequences for arrows — so there is
 * no key translation to get wrong.
 *
 * Geometry is owned by the CLI process attached to the PTY; it reports its
 * dimensions as a `{t:"dims"}` control frame and this page resizes its
 * emulator to match. Resizing the browser deliberately does not resize the
 * PTY, which would reflow the local terminal. A wide PTY therefore renders at
 * native size and the frame scrolls, rather than being scaled down to fit.
 */
function TerminalDevPage() {
  const sessions = useAllSessions();
  const liveSessions = sessions.filter(({ session }) =>
    LIVE_STATUSES.has(session.status),
  );

  const [sessionId, setSessionId] = useState("");
  const [connected, setConnected] = useState(false);
  const [dims, setDims] = useState<{ cols: number; rows: number } | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<IDisposable | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: { background: "#0b0b0c", foreground: "#e6e6e6" },
    });
    term.open(host);
    termRef.current = term;

    return () => {
      inputRef.current?.dispose();
      inputRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  function connect() {
    const term = termRef.current;
    if (!sessionId || !term || socketRef.current) return;

    term.reset();
    const ws = new WebSocket(
      wsUrl(`/ws/sessions/${sessionId}/terminal?role=browser`),
    );
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setConnected(true);
      term.focus();
    };
    ws.onclose = () => {
      setConnected(false);
      socketRef.current = null;
    };
    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const frame = JSON.parse(event.data);
          if (
            frame?.t === "dims" &&
            typeof frame.cols === "number" &&
            typeof frame.rows === "number"
          ) {
            term.resize(frame.cols, frame.rows);
            setDims({ cols: frame.cols, rows: frame.rows });
          }
        } catch {
          // Ignore malformed control frames.
        }
        return;
      }
      // Hand the emulator raw bytes — it decodes UTF-8 across chunk
      // boundaries itself, so there's no partial-codepoint handling here.
      term.write(new Uint8Array(event.data as ArrayBuffer));
    };

    inputRef.current = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data));
      }
    });

    socketRef.current = ws;
  }

  function disconnect() {
    inputRef.current?.dispose();
    inputRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  }

  return (
    <Stack gap={4} p={6} fullwidth style={{ overflow: "auto" }}>
      <Stack gap={2}>
        <Text size={3} weight="bold">
          Terminal relay
        </Text>
        <Text size={2} shade="muted">
          Attaches to a live session's PTY over the websocket relay in{" "}
          <code>src/server/terminal-relay.ts</code>. Keystrokes go straight to
          the same <code>claude</code> process the local terminal is driving —
          type here and the local terminal follows along.
        </Text>
      </Stack>

      <Group gap={3} ay="center">
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          disabled={connected}
          style={{ fontSize: 13, padding: "5px 8px" }}
        >
          <option value="">Select a live session…</option>
          {liveSessions.map(({ session }) => (
            <option key={session.id} value={session.id}>
              {session.name} ({session.status})
            </option>
          ))}
        </select>

        {connected ? (
          <Button size="small" variant="subtle" onClick={disconnect}>
            Detach
          </Button>
        ) : (
          <Button size="small" onClick={connect} disabled={!sessionId}>
            Attach
          </Button>
        )}

        <Badge color={connected ? "green" : "neutral"}>
          {connected ? "attached" : "detached"}
        </Badge>

        {dims ? (
          <Text size={1} shade="muted">
            {dims.cols}×{dims.rows} (owned by the local terminal)
          </Text>
        ) : null}
      </Group>

      <Card>
        {/*
          The PTY's size is fixed by the local terminal, so the terminal renders
          at native size and this frame scrolls — sizing to content, capped so a
          tall session doesn't take over the page.
        */}
        <div
          style={{
            maxHeight: MAX_FRAME_HEIGHT,
            overflow: "auto",
            background: "#0b0b0c",
            borderRadius: 4,
          }}
        >
          <div ref={hostRef} />
        </div>
      </Card>
    </Stack>
  );
}

export const Route = createFileRoute("/dev/terminal")({
  component: TerminalDevPage,
});
