import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, Card, Group, Stack, Text } from "@uiid/design-system";

import { wsUrl } from "../../api/base";
import { useAllSessions } from "../../lib/use-sessions";

const LIVE_STATUSES = new Set(["active", "waiting", "blocked"]);

/**
 * Proof that the PR #204 terminal relay works from an actual browser tab —
 * connects to a real live session's PTY over
 * `/ws/sessions/:id/terminal?role=browser` and round-trips raw bytes. Not the
 * xterm.js component the design doc describes as the real next increment;
 * just enough to see the backend work end to end from the dashboard.
 */
function TerminalDevPage() {
  const sessions = useAllSessions();
  const liveSessions = sessions.filter(({ session }) =>
    LIVE_STATUSES.has(session.status),
  );

  const [sessionId, setSessionId] = useState("");
  const [connected, setConnected] = useState(false);
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef(new TextDecoder());
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => () => socketRef.current?.close(), []);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  function connect() {
    if (!sessionId) return;
    const ws = new WebSocket(
      wsUrl(`/ws/sessions/${sessionId}/terminal?role=browser`),
    );
    ws.binaryType = "arraybuffer";
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (event) => {
      // Browsers only ever receive PTY output frames (binary); resize control
      // frames flow the other direction, browser -> upstream.
      if (typeof event.data === "string") return;
      setOutput(
        (prev) => prev + decoderRef.current.decode(event.data, { stream: true }),
      );
    };
    socketRef.current = ws;
  }

  function disconnect() {
    socketRef.current?.close();
    socketRef.current = null;
    setConnected(false);
  }

  function sendLine() {
    if (socketRef.current?.readyState !== WebSocket.OPEN || !input) return;
    socketRef.current.send(new TextEncoder().encode(input + "\n"));
    setInput("");
  }

  return (
    <Stack gap={4} p={6} fullwidth style={{ overflow: "auto" }}>
      <Stack gap={2}>
        <Text size={3} weight="bold">
          Terminal relay proof
        </Text>
        <Text size={2} shade="muted">
          Connects to a live session's PTY over the websocket relay from{" "}
          <code>src/server/terminal-relay.ts</code> (PR #204). Pick a live
          session, connect, and send a line — output streams back from the
          real <code>claude</code> process, proving the relay works from an
          actual browser tab.
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
            Disconnect
          </Button>
        ) : (
          <Button size="small" onClick={connect} disabled={!sessionId}>
            Connect
          </Button>
        )}

        <Badge color={connected ? "green" : "neutral"}>
          {connected ? "connected" : "disconnected"}
        </Badge>
      </Group>

      <Card>
        <pre
          ref={outputRef}
          style={{
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.5,
            padding: 12,
            minHeight: 320,
            maxHeight: 480,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
          }}
        >
          {output || "(no output yet)"}
        </pre>
      </Card>

      <Group gap={2} fullwidth>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendLine();
          }}
          disabled={!connected}
          placeholder="Type a line, press Enter to send"
          style={{
            flex: 1,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 13,
            padding: "6px 10px",
            border: "1px solid var(--color-border)",
            borderRadius: 4,
            background: "var(--color-surface)",
            color: "var(--color-text)",
          }}
        />
        <Button size="small" onClick={sendLine} disabled={!connected || !input}>
          Send
        </Button>
      </Group>
    </Stack>
  );
}

export const Route = createFileRoute("/dev/terminal")({
  component: TerminalDevPage,
});
