import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Card, Group, Stack, Text } from "@uiid/design-system";

import {
  SessionTerminal,
  type TerminalDiagnostics,
} from "../../components/terminal";
import { useAllSessions } from "../../lib/use-sessions";

const LIVE_STATUSES = new Set(["active", "waiting", "blocked"]);

/** Frame sizes to drop the terminal into, proving it fits each one. */
const FRAMES = {
  panel: { label: "Panel", width: "100%", height: 420 },
  drawer: { label: "Drawer", width: 520, height: 320 },
  sidebar: { label: "Sidebar zone", width: 340, height: 260 },
  mobile: { label: "Mobile", width: 390, height: 560 },
  tall: { label: "Tall", width: "100%", height: 700 },
} as const;

type FrameKey = keyof typeof FRAMES;

/**
 * Harness for `<SessionTerminal>` (dashboard/src/components/terminal) — the same
 * component the session view embeds, exercised here against deliberately
 * awkward boxes.
 *
 * The point of this page is the frame picker: the terminal has to fit wherever
 * it is placed (a resizable panel, a drawer, a narrow sidebar zone, a
 * phone-width viewport), so being able to flip a live session between those
 * sizes is how that gets checked. What should be visible is a *reflow* — same
 * font size, different number of rows and columns — not scaled text. See
 * `../../components/terminal/geometry.ts`.
 */
function TerminalDevPage() {
  const sessions = useAllSessions();
  const liveSessions = sessions.filter(({ session }) =>
    LIVE_STATUSES.has(session.status),
  );

  const [sessionId, setSessionId] = useState("");
  const [frame, setFrame] = useState<FrameKey>("panel");
  const [diagnostics, setDiagnostics] = useState<TerminalDiagnostics | null>(
    null,
  );
  const active = FRAMES[frame];

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
          type here and the local terminal follows along. The font size is fixed,
          so switching frames changes how many rows and columns fit and the PTY
          reflows — the local terminal reflows with it, capped so it is never
          asked for more columns than its own window has.
        </Text>
      </Stack>

      <Group gap={3} ay="center" style={{ flexWrap: "wrap" }}>
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ fontSize: 13, padding: "5px 8px" }}
        >
          <option value="">Select a live session…</option>
          {liveSessions.map(({ session }) => (
            <option key={session.id} value={session.id}>
              {session.name} ({session.status})
            </option>
          ))}
        </select>

        <Group gap={1} ay="center">
          {(Object.keys(FRAMES) as FrameKey[]).map((key) => (
            <Button
              key={key}
              size="small"
              variant={frame === key ? undefined : "subtle"}
              onClick={() => setFrame(key)}
            >
              {FRAMES[key].label}
            </Button>
          ))}
        </Group>

        <Text size={1} shade="muted" family="mono">
          {typeof active.width === "number" ? `${active.width}px` : active.width}{" "}
          × {active.height}px
        </Text>
      </Group>

      {sessionId ? (
        <Card>
          {/*
            A box of a deliberately arbitrary size. The terminal is told nothing
            about it — it measures its own container and refits, which is what
            makes it portable across panels, drawers, and phone viewports.
          */}
          <div
            style={{
              width: active.width,
              maxWidth: "100%",
              height: active.height,
              border: "1px solid rgba(127,127,127,0.35)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {/* Keyed on the frame so switching sizes also proves a cold mount
                into that box works, not just a resize into it. */}
            <SessionTerminal
              key={sessionId}
              sessionId={sessionId}
              onDiagnostics={setDiagnostics}
            />
          </div>
        </Card>
      ) : (
        <Text size={2} shade="muted">
          Pick a live session to attach.
        </Text>
      )}

      {diagnostics && <ScrollDiagnostics diagnostics={diagnostics} />}
    </Stack>
  );
}

/**
 * Why scrolling behaves the way it does, since none of it is visible from the
 * outside: whether the program is on the alternate screen (no scrollback exists
 * there at all), whether any scrollback has accumulated, and whether wheel events
 * are reaching xterm's hook.
 */
const ScrollDiagnostics = ({
  diagnostics: d,
}: {
  readonly diagnostics: TerminalDiagnostics;
}) => {
  const hasScrollback = d.bufferLength > d.rows;
  const wheelReachesXterm = d.xtermWheelEvents > 0;

  // Typing comes first: onData only sends while the socket is OPEN and xterm has
  // focus, so either being wrong looks like a terminal that ignores the keyboard.
  const typingVerdict =
    d.socketState !== "open"
      ? `Typing can't work: the socket is "${d.socketState}"${d.retries > 0 ? ` after ${d.retries} reconnect attempts` : ""}. Keystrokes are dropped because there is nothing open to send them to.`
      : !d.focused
        ? "Socket is open but xterm doesn't have focus, so keystrokes go elsewhere. Click the terminal."
        : "Socket is open and xterm has focus — typing should reach the PTY.";

  const verdict = !d.hostWheelEvents
    ? "No wheel events at all — the pointer isn't over the terminal, or something upstream is swallowing them."
    : !wheelReachesXterm
      ? "Wheel reaches the container but not xterm — something is stopping propagation before it."
      : d.bufferType === "alternate"
        ? "Alternate screen: no scrollback exists, so scrolling belongs to the program. xterm forwards the wheel to it (as mouse wheel events if it asked for them, otherwise as up/down sequences). If nothing moves, the program isn't acting on them — the same as it would behave in a real terminal."
        : hasScrollback
          ? "Normal buffer with scrollback, and the wheel is reaching xterm — this should be scrolling its viewport."
          : "Normal buffer but no scrollback has accumulated yet, so there is nothing above the viewport to scroll to.";

  return (
    <Card>
      <Stack gap={2} p={3}>
        <Text size={2} weight="bold">
          Scroll diagnostics
        </Text>
        <Text size={1} family="mono">
          buffer: {d.bufferType} · {d.bufferLength} lines / {d.rows} rows ·{" "}
          {hasScrollback ? `${d.bufferLength - d.rows} scrollback` : "no scrollback"}
        </Text>
        <Text size={1} family="mono">
          grid: {d.cols}×{d.rows} · viewport: {d.viewportScrollHeight}px scroll /{" "}
          {d.viewportClientHeight}px client
        </Text>
        <Text size={1} family="mono">
          wheel: {d.hostWheelEvents} at container · {d.xtermWheelEvents} at xterm
        </Text>
        <Text size={1} family="mono">
          socket: {d.socketState} · focus: {d.focused ? "yes" : "no"} · retries:{" "}
          {d.retries}
        </Text>
        {/* Only ever "released" while this page is unread, so it can't be
            observed by watching it — switch away and back, or read it in a
            visible-but-unfocused window, where the poll keeps updating. */}
        <Text size={1} family="mono">
          sizing: {d.sizingAuthority}
        </Text>
        <Text size={1} shade="muted">
          input — {typingVerdict}
        </Text>
        <Text size={1} shade="muted">
          scroll — {verdict}
        </Text>
      </Stack>
    </Card>
  );
};
ScrollDiagnostics.displayName = "ScrollDiagnostics";

export const Route = createFileRoute("/dev/terminal")({
  component: TerminalDevPage,
});
