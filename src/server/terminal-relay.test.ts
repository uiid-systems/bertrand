import { describe, test, expect, afterEach } from "bun:test";
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "./terminal-relay";

let server: ReturnType<typeof Bun.serve> | null = null;

function startTestServer() {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    websocket: terminalWebSocketHandlers,
    fetch(req, srv) {
      const url = new URL(req.url);
      const result = tryUpgradeTerminal(req, srv, url);
      if (result !== false) return result;
      return new Response("not found", { status: 404 });
    },
  });
  return server;
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve();
  });
}

function waitMessage(ws: WebSocket): Promise<string | ArrayBuffer> {
  return new Promise((resolve) => {
    ws.onmessage = (event) => resolve(event.data as string | ArrayBuffer);
  });
}

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe("terminal relay", () => {
  test("upstream output reaches a browser subscriber", async () => {
    const srv = startTestServer();
    const sessionId = "sess-1";

    const upstream = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/${sessionId}/terminal?role=upstream`);
    const browser = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/${sessionId}/terminal?role=browser`);
    await Promise.all([waitOpen(upstream), waitOpen(browser)]);

    const received = waitMessage(browser);
    upstream.send(new TextEncoder().encode("hello from pty"));

    const data = await received;
    expect(Buffer.from(data as ArrayBuffer).toString()).toBe("hello from pty");

    upstream.close();
    browser.close();
  });

  test("browser input reaches the upstream connection", async () => {
    const srv = startTestServer();
    const sessionId = "sess-2";

    const upstream = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/${sessionId}/terminal?role=upstream`);
    const browser = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/${sessionId}/terminal?role=browser`);
    await Promise.all([waitOpen(upstream), waitOpen(browser)]);

    const received = waitMessage(upstream);
    browser.send(JSON.stringify({ cols: 100, rows: 40 }));

    const data = await received;
    expect(JSON.parse(data as string)).toEqual({ cols: 100, rows: 40 });

    upstream.close();
    browser.close();
  });

  test("sessions are isolated — a different session's browser doesn't see this session's output", async () => {
    const srv = startTestServer();

    const upstreamA = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/a/terminal?role=upstream`);
    const browserB = new WebSocket(`ws://127.0.0.1:${srv.port}/ws/sessions/b/terminal?role=browser`);
    await Promise.all([waitOpen(upstreamA), waitOpen(browserB)]);

    let browserBReceived = false;
    browserB.onmessage = () => {
      browserBReceived = true;
    };
    upstreamA.send("leak?");

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(browserBReceived).toBe(false);

    upstreamA.close();
    browserB.close();
  });
});
