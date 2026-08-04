import { describe, test, expect, afterEach } from "bun:test";
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "./terminal-relay";

let server: ReturnType<typeof Bun.serve> | null = null;

/** Starts the relay on an ephemeral port and returns that port. */
function startTestServer(): number {
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
  const { port } = server;
  if (port === undefined) throw new Error("test server did not bind a port");
  return port;
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve();
  });
}

/**
 * Accumulates everything a socket receives, split by frame kind. The relay
 * interleaves binary PTY bytes with JSON control frames, so tests need to look
 * at one without tripping over the other.
 */
function collect(ws: WebSocket): { binary: string[]; text: string[] } {
  const sink: { binary: string[]; text: string[] } = { binary: [], text: [] };
  ws.binaryType = "arraybuffer";
  ws.onmessage = (event) => {
    if (typeof event.data === "string") sink.text.push(event.data);
    else sink.binary.push(Buffer.from(event.data as ArrayBuffer).toString());
  };
  return sink;
}

/** Lets the relay's async pub/sub delivery drain before asserting. */
function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectUpstream(port: number, sessionId: string): WebSocket {
  return new WebSocket(
    `ws://127.0.0.1:${port}/ws/sessions/${sessionId}/terminal?role=upstream`,
  );
}

function connectBrowser(port: number, sessionId: string): WebSocket {
  return new WebSocket(
    `ws://127.0.0.1:${port}/ws/sessions/${sessionId}/terminal?role=browser`,
  );
}

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe("terminal relay", () => {
  test("upstream output reaches a browser subscriber", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-1");
    const browser = connectBrowser(port, "sess-1");
    await Promise.all([waitOpen(upstream), waitOpen(browser)]);

    const seen = collect(browser);
    upstream.send(new TextEncoder().encode("hello from pty"));
    await settle();

    expect(seen.binary.join("")).toBe("hello from pty");

    upstream.close();
    browser.close();
  });

  test("browser keystrokes reach the upstream connection", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-2");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "sess-2");
    await waitOpen(browser);

    browser.send(new TextEncoder().encode("ls -la\r"));
    await settle();

    expect(seen.binary.join("")).toBe("ls -la\r");

    upstream.close();
    browser.close();
  });

  test("a browser cannot report the PTY's size — only upstream may", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-3");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "sess-3");
    await waitOpen(browser);

    // Reporting the PTY's real geometry is upstream's job. A browser that wants
    // a different size has to `claim` one, which is negotiated and reversible —
    // a bare `dims` frame from a browser must not be forwarded as if the PTY had
    // actually changed size.
    browser.send(JSON.stringify({ t: "dims", cols: 100, rows: 40 }));
    browser.send(JSON.stringify({ cols: 100, rows: 40 }));
    await settle();

    expect(seen.text.some((frame) => frame.includes("dims"))).toBe(false);
    expect(seen.binary).toEqual([]);

    upstream.close();
    browser.close();
  });

  test("a browser claim is forwarded upstream as a setsize request", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "claim-1");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "claim-1");
    await waitOpen(browser);
    browser.send(JSON.stringify({ t: "claim", cols: 120, rows: 40 }));
    await settle();

    expect(seen.text.map((f) => JSON.parse(f))).toContainEqual({
      t: "setsize",
      cols: 120,
      rows: 40,
    });

    upstream.close();
    browser.close();
  });

  test("the smallest claim across browsers wins, per axis", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "claim-2");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const wide = connectBrowser(port, "claim-2");
    const tall = connectBrowser(port, "claim-2");
    await Promise.all([waitOpen(wide), waitOpen(tall)]);

    // Neither browser's pair wins outright: the result takes the smaller of
    // each axis so both can display the frame in full.
    wide.send(JSON.stringify({ t: "claim", cols: 200, rows: 30 }));
    await settle();
    tall.send(JSON.stringify({ t: "claim", cols: 90, rows: 60 }));
    await settle();

    const setsizes = seen.text
      .map((f) => JSON.parse(f))
      .filter((f) => f.t === "setsize");
    expect(setsizes.at(-1)).toEqual({ t: "setsize", cols: 90, rows: 30 });

    upstream.close();
    wide.close();
    tall.close();
  });

  test("unclaiming and disconnecting both release the claim", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "claim-3");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "claim-3");
    await waitOpen(browser);
    browser.send(JSON.stringify({ t: "claim", cols: 100, rows: 30 }));
    await settle();
    browser.send(JSON.stringify({ t: "unclaim" }));
    await settle();

    const afterUnclaim = seen.text
      .map((f) => JSON.parse(f))
      .filter((f) => f.t === "setsize");
    // Nulls mean "no browser is claiming — use your own terminal's size".
    expect(afterUnclaim.at(-1)).toEqual({ t: "setsize", cols: null, rows: null });

    // A closed tab must not keep the PTY pinned to a window nobody is viewing.
    browser.send(JSON.stringify({ t: "claim", cols: 100, rows: 30 }));
    await settle();
    browser.close();
    await settle();

    const afterClose = seen.text
      .map((f) => JSON.parse(f))
      .filter((f) => f.t === "setsize");
    expect(afterClose.at(-1)).toEqual({ t: "setsize", cols: null, rows: null });

    upstream.close();
  });

  test("out-of-bounds claims are ignored", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "claim-4");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "claim-4");
    await waitOpen(browser);

    // A malformed or hostile claim shouldn't be able to wedge a real PTY.
    browser.send(JSON.stringify({ t: "claim", cols: 1, rows: 1 }));
    browser.send(JSON.stringify({ t: "claim", cols: 99999, rows: 99999 }));
    browser.send(JSON.stringify({ t: "claim", cols: 80.5, rows: 24 }));
    await settle();

    expect(seen.text.some((f) => f.includes("setsize"))).toBe(false);

    upstream.close();
    browser.close();
  });

  test("upstream reconnecting is told about outstanding claims", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "claim-5");
    await waitOpen(upstream);

    const browser = connectBrowser(port, "claim-5");
    await waitOpen(browser);
    browser.send(JSON.stringify({ t: "claim", cols: 110, rows: 35 }));
    await settle();

    // Server-side state survives the process that owned the PTY reconnecting,
    // so a browser that took sizing over doesn't silently lose it.
    upstream.close();
    await settle();

    const revived = connectUpstream(port, "claim-5");
    const seen = collect(revived);
    await waitOpen(revived);
    await settle();

    expect(seen.text.map((f) => JSON.parse(f))).toContainEqual({
      t: "setsize",
      cols: 110,
      rows: 35,
    });

    revived.close();
    browser.close();
  });

  test("attaching browser is told the geometry upstream reported", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-4");
    await waitOpen(upstream);

    upstream.send(JSON.stringify({ t: "dims", cols: 190, rows: 50 }));
    await settle();

    // Attaching *after* the report still gets it, because the relay remembers.
    const browser = connectBrowser(port, "sess-4");
    const seen = collect(browser);
    await waitOpen(browser);
    await settle();

    expect(seen.text.map((f) => JSON.parse(f))).toContainEqual({
      t: "dims",
      cols: 190,
      rows: 50,
    });

    upstream.close();
    browser.close();
  });

  test("geometry changes are forwarded to already-attached browsers", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-5");
    const browser = connectBrowser(port, "sess-5");
    await Promise.all([waitOpen(upstream), waitOpen(browser)]);

    const seen = collect(browser);
    upstream.send(JSON.stringify({ t: "dims", cols: 120, rows: 30 }));
    await settle();

    expect(seen.text.map((f) => JSON.parse(f))).toContainEqual({
      t: "dims",
      cols: 120,
      rows: 30,
    });

    upstream.close();
    browser.close();
  });

  test("recent output is replayed to a browser that attaches mid-session", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-6");
    await waitOpen(upstream);

    upstream.send(new TextEncoder().encode("output before attach"));
    await settle();

    const browser = connectBrowser(port, "sess-6");
    const seen = collect(browser);
    await waitOpen(browser);
    await settle();

    // Without replay the browser would show a blank screen until the next byte.
    expect(seen.binary.join("")).toContain("output before attach");

    upstream.close();
    browser.close();
  });

  test("an attaching browser asks upstream for a repaint", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-7");
    await waitOpen(upstream);
    const seen = collect(upstream);

    const browser = connectBrowser(port, "sess-7");
    await waitOpen(browser);
    await settle();

    expect(seen.text.map((f) => JSON.parse(f))).toContainEqual({ t: "repaint" });

    upstream.close();
    browser.close();
  });

  test("replay history is dropped once upstream disconnects", async () => {
    const port = startTestServer();
    const upstream = connectUpstream(port, "sess-8");
    await waitOpen(upstream);

    upstream.send(new TextEncoder().encode("output from a dead session"));
    await settle();
    upstream.close();
    await settle();

    const browser = connectBrowser(port, "sess-8");
    const seen = collect(browser);
    await waitOpen(browser);
    await settle();

    expect(seen.binary).toEqual([]);

    browser.close();
  });

  test("sessions are isolated — a different session's browser doesn't see this session's output", async () => {
    const port = startTestServer();

    const upstreamA = connectUpstream(port, "a");
    const browserB = connectBrowser(port, "b");
    await Promise.all([waitOpen(upstreamA), waitOpen(browserB)]);

    const seen = collect(browserB);
    upstreamA.send(new TextEncoder().encode("leak?"));
    upstreamA.send(JSON.stringify({ t: "dims", cols: 10, rows: 10 }));
    await settle();

    expect(seen.binary).toEqual([]);
    expect(seen.text).toEqual([]);

    upstreamA.close();
    browserB.close();
  });
});
