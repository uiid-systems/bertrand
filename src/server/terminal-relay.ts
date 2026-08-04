import type { Server, ServerWebSocket } from "bun";

/**
 * Relays a session's PTY between the CLI process that owns it (role
 * "upstream", see src/engine/process.ts) and any number of dashboard
 * browsers (role "browser") — see docs/pty-wrapper.md. Uses Bun's built-in
 * pub/sub topics instead of a hand-rolled connection registry: upstream
 * subscribes to the input topic and publishes to the output topic; browsers
 * do the reverse. Output frames are always binary PTY bytes; input frames
 * from a browser are binary (raw keystrokes) or text (`{cols,rows}` resize).
 */

export type TerminalRole = "upstream" | "browser";

export interface TerminalSocketData {
  sessionId: string;
  role: TerminalRole;
}

const TERMINAL_WS_PATH = /^\/ws\/sessions\/([^/]+)\/terminal$/;

function outputTopic(sessionId: string): string {
  return `terminal:${sessionId}:output`;
}

function inputTopic(sessionId: string): string {
  return `terminal:${sessionId}:input`;
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
    ws.subscribe(role === "upstream" ? inputTopic(sessionId) : outputTopic(sessionId));
  },
  message(ws: ServerWebSocket<TerminalSocketData>, message: string | Buffer) {
    const { sessionId, role } = ws.data;
    ws.publish(role === "upstream" ? outputTopic(sessionId) : inputTopic(sessionId), message);
  },
};
