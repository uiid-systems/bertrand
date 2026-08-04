import { describe, test, expect, afterEach } from "bun:test";
import { tryUpgradeTerminal, terminalWebSocketHandlers } from "@/server/terminal-relay";
import { smallestDims, spawnPty } from "./pty";
import { connectTerminalRelay } from "./terminal-relay-client";

/**
 * Exercises the full loop launchClaude() wires up — spawnPty +
 * connectTerminalRelay talking to a real Bun.serve running the actual
 * server-side relay handlers — with `cat` standing in for `claude` so this
 * doesn't depend on the real binary or session/DB machinery.
 */

let server: ReturnType<typeof Bun.serve> | null = null;
let prevPort: string | undefined;

afterEach(() => {
  server?.stop(true);
  server = null;
  if (prevPort === undefined) delete process.env.BERTRAND_PORT;
  else process.env.BERTRAND_PORT = prevPort;
});

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

describe("PTY + relay integration", () => {
  test("a browser sees PTY output and can drive input, round-tripped through cat", async () => {
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
    prevPort = process.env.BERTRAND_PORT;
    process.env.BERTRAND_PORT = String(server.port);

    const sessionId = "integration-session";

    const browserChunks: string[] = [];
    const browser = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/sessions/${sessionId}/terminal?role=browser`,
    );
    browser.onmessage = (event) => {
      browserChunks.push(Buffer.from(event.data as ArrayBuffer).toString());
    };
    await waitOpen(browser);

    let relay: ReturnType<typeof connectTerminalRelay>;
    const pty = spawnPty(["cat"], {
      onData: (chunk) => relay.send(chunk),
    });
    relay = connectTerminalRelay({
      sessionId,
      onInput: (chunk) => pty.write(chunk),
      onRepaint: () => {},
      onSetSize: () => {},
    });

    // Local-terminal-equivalent write: cat echoes it back through the PTY,
    // out through the relay, to the browser.
    pty.write("from local terminal\n");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(browserChunks.join("")).toContain("from local terminal");

    // Browser-equivalent write: same PTY, same echo, proving local and
    // browser input are interchangeable fan-in points onto one PTY.
    const resultFromBrowser = waitMessage(browser);
    browser.send(new TextEncoder().encode("from browser\n"));
    const echoed = await resultFromBrowser;
    expect(Buffer.from(echoed as ArrayBuffer).toString()).toContain("from browser");

    relay.close();
    browser.close();
    pty.kill();
    await pty.exited;
  });

  test("a browser attaching mid-session gets replayed output, reported geometry, and triggers a repaint", async () => {
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
    prevPort = process.env.BERTRAND_PORT;
    process.env.BERTRAND_PORT = String(server.port);

    const sessionId = "late-attach-session";
    let repaints = 0;

    let relay: ReturnType<typeof connectTerminalRelay>;
    const pty = spawnPty(["cat"], {
      onData: (chunk) => relay.send(chunk),
    });
    relay = connectTerminalRelay({
      sessionId,
      onInput: (chunk) => pty.write(chunk),
      onRepaint: () => {
        repaints += 1;
      },
      onSetSize: () => {},
    });
    relay.sendDims(190, 50);

    // Output produced before any browser exists — the case that used to leave
    // an attaching browser staring at a blank screen.
    pty.write("printed before anyone attached\n");
    await new Promise((resolve) => setTimeout(resolve, 200));

    const binary: string[] = [];
    const text: string[] = [];
    const browser = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/sessions/${sessionId}/terminal?role=browser`,
    );
    browser.binaryType = "arraybuffer";
    browser.onmessage = (event) => {
      if (typeof event.data === "string") text.push(event.data);
      else binary.push(Buffer.from(event.data as ArrayBuffer).toString());
    };
    await waitOpen(browser);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(binary.join("")).toContain("printed before anyone attached");
    expect(text.map((frame) => JSON.parse(frame))).toContainEqual({
      t: "dims",
      cols: 190,
      rows: 50,
    });
    expect(repaints).toBeGreaterThan(0);

    relay.close();
    browser.close();
    pty.kill();
    await pty.exited;
  });

  test("a browser can take PTY sizing over, is capped by the local terminal, and releases it", async () => {
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
    prevPort = process.env.BERTRAND_PORT;
    process.env.BERTRAND_PORT = String(server.port);

    const sessionId = "takeover-session";
    // Stands in for process.stdout's dimensions, which launchClaude() reads.
    const local = { cols: 190, rows: 50 };
    let claim: { cols: number; rows: number } | null = null;

    let relay: ReturnType<typeof connectTerminalRelay>;
    const pty = spawnPty(["cat"], {
      onData: (chunk) => relay.send(chunk),
    });

    // Mirrors launchClaude()'s applyDims(), using the same smallestDims() the
    // real code path uses so this exercises the actual policy, not a copy.
    const applyDims = () => {
      const { cols, rows } = smallestDims(local, claim);
      pty.resize(cols, rows);
      relay.sendDims(cols, rows);
    };

    relay = connectTerminalRelay({
      sessionId,
      onInput: (chunk) => pty.write(chunk),
      onRepaint: () => {},
      onSetSize: (dims) => {
        claim = dims;
        applyDims();
      },
    });
    relay.sendDims(local.cols, local.rows);

    const dims: Array<{ cols: number; rows: number }> = [];
    const browser = new WebSocket(
      `ws://127.0.0.1:${server.port}/ws/sessions/${sessionId}/terminal?role=browser`,
    );
    browser.binaryType = "arraybuffer";
    browser.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const frame = JSON.parse(event.data);
      if (frame?.t === "dims") dims.push({ cols: frame.cols, rows: frame.rows });
    };
    await waitOpen(browser);

    const step = async (frame: unknown) => {
      browser.send(JSON.stringify(frame));
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    // Taking over: the PTY follows the browser's panel.
    await step({ t: "claim", cols: 100, rows: 30 });
    expect(dims.at(-1)).toEqual({ cols: 100, rows: 30 });

    // A browser cannot force the PTY *bigger* than the local terminal — that
    // would wrap output in the window the session is really attached to.
    await step({ t: "claim", cols: 400, rows: 120 });
    expect(dims.at(-1)).toEqual({ cols: 190, rows: 50 });

    await step({ t: "claim", cols: 120, rows: 40 });
    expect(dims.at(-1)).toEqual({ cols: 120, rows: 40 });

    // Releasing hands sizing back to the local terminal.
    await step({ t: "unclaim" });
    expect(dims.at(-1)).toEqual({ cols: 190, rows: 50 });

    // Out-of-bounds claims are ignored rather than resizing the PTY to nonsense.
    await step({ t: "claim", cols: 2, rows: 1 });
    expect(dims.at(-1)).toEqual({ cols: 190, rows: 50 });

    relay.close();
    browser.close();
    pty.kill();
    await pty.exited;
  });
});
