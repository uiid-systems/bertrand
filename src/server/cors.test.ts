import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  registerProject,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { invalidateDbCache, _clearTestDb } from "@/db/client";
import { startServer } from "./index";

/**
 * The API is unauthenticated and exposes routes that spawn processes, so the
 * origin allowlist is the only thing standing between it and any page the user
 * has open. It used to answer `Access-Control-Allow-Origin: *`; loopback
 * binding is no defence, since a browser is itself a local process.
 *
 * The load-bearing case is the last one: an untrusted origin must be *refused*,
 * not merely denied the response header. CORS gates reading a reply, not
 * sending the request, so a "simple" cross-origin POST would otherwise still
 * run the handler for its side effect.
 */

let tmpRoot: string;
let server: ReturnType<typeof startServer>;
const originalDir = _getRegistryDir();
const originalWorkspace = process.env.BERTRAND_WORKSPACE;

beforeEach(() => {
  // Gate startServer's global boot sweeps off the real machine (see
  // projects-api.test.ts).
  process.env.BERTRAND_WORKSPACE = "1";
  delete process.env.BERTRAND_PROJECT;

  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-cors-"));
  _setRegistryDir(tmpRoot);
  _resetActiveProjectCache();
  invalidateDbCache();
  _clearTestDb();

  registerProject({ slug: "cors", name: "CORS Project" });
  server = startServer(0);
});

afterEach(() => {
  server.stop(true);
  _setRegistryDir(originalDir);
  _resetActiveProjectCache();
  invalidateDbCache();
  _clearTestDb();
  rmSync(tmpRoot, { recursive: true, force: true });

  if (originalWorkspace === undefined) {
    delete process.env.BERTRAND_WORKSPACE;
  } else {
    process.env.BERTRAND_WORKSPACE = originalWorkspace;
  }
});

const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

describe("CORS origin allowlist", () => {
  test("echoes the hosted page's origin rather than a wildcard", async () => {
    const res = await fetch(url("/api/projects"), {
      headers: { origin: "https://bertrand.sh" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bertrand.sh");
    // Shared caches must not serve one origin's response to another.
    expect(res.headers.get("vary")).toBe("Origin");
  });

  test("allows the vite dev server's origin", async () => {
    const res = await fetch(url("/api/projects"), {
      headers: { origin: "http://localhost:5199" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5199");
  });

  test("refuses a localhost origin on an unnamed port", async () => {
    // The allowlist names exact ports rather than trusting localhost wholesale,
    // so some other local dev server cannot reach this API just by being local.
    const res = await fetch(url("/api/projects"), {
      headers: { origin: "http://localhost:5173" },
    });

    expect(res.status).toBe(403);
  });

  test("serves a request with no Origin and adds no CORS header", async () => {
    // curl, the TUI, and same-origin browser GETs all land here.
    const res = await fetch(url("/api/projects"));

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("answers a preflight from an allowed origin", async () => {
    const res = await fetch(url("/api/projects"), {
      method: "OPTIONS",
      headers: { origin: "https://bertrand.sh" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://bertrand.sh");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("refuses a preflight from an untrusted origin", async () => {
    const res = await fetch(url("/api/projects"), {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  test("refuses an untrusted origin outright, so a no-preflight POST never reaches the handler", async () => {
    // text/plain keeps this a "simple" request: a real browser would send it
    // without a preflight, so withholding the response header alone would have
    // let the side effect happen anyway.
    const res = await fetch(url("/api/open"), {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      body: JSON.stringify({ path: "/tmp" }),
    });

    expect(res.status).toBe(403);
  });

  test("refuses a cross-origin session spawn", async () => {
    const res = await fetch(url("/api/sessions/spawn"), {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "text/plain" },
      body: "{}",
    });

    expect(res.status).toBe(403);
  });

  test("refuses a WebSocket upgrade from an untrusted origin", async () => {
    // WebSockets are outside CORS entirely, so the origin guard has to run
    // before the upgrade or any page could attach to a session's terminal
    // relay — reading its output and writing its input.
    const res = await fetch(url("/ws/sessions/some-session/terminal"), {
      headers: {
        origin: "https://evil.example",
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    });

    expect(res.status).toBe(403);
  });
});
