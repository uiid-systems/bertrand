import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Card, Group, Stack, Text } from "@uiid/design-system";

import { SessionTerminal } from "../../components/terminal";
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
            <SessionTerminal key={sessionId} sessionId={sessionId} />
          </div>
        </Card>
      ) : (
        <Text size={2} shade="muted">
          Pick a live session to attach.
        </Text>
      )}
    </Stack>
  );
}

export const Route = createFileRoute("/dev/terminal")({
  component: TerminalDevPage,
});
