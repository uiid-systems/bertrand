import { describe, test, expect, afterEach } from "bun:test";

import { evictProjectFromServer, _setTestDeps, _resetTestDeps } from "./evict";

/**
 * These run against a real `Bun.serve` rather than a stubbed fetch. The point
 * of this module is the wire contract between two processes, and a stub would
 * happily agree with whatever shape the client happens to send.
 */
function withServer(handler: (req: Request) => Response | Promise<Response>): {
  port: number;
  /** Method and path only — enough to pin the contract, and free of the
   * Request-type mismatch between Bun's and undici's DOM lib definitions. */
  requests: { method: string; pathname: string }[];
  stop: () => void;
} {
  const requests: { method: string; pathname: string }[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      requests.push({ method: req.method, pathname: new URL(req.url).pathname });
      return handler(req);
    },
  });
  return { port: server.port!, requests, stop: () => server.stop(true) };
}

afterEach(() => _resetTestDeps());

describe("evictProjectFromServer", () => {
  test("POSTs to the slug's evict route and reports what was closed", async () => {
    const srv = withServer(() => Response.json({ ok: true, closed: true }));
    _setTestDeps({ port: srv.port });

    const result = await evictProjectFromServer("doomed");

    expect(result).toEqual({ status: "evicted", closed: true });
    expect(srv.requests[0]).toEqual({
      method: "POST",
      pathname: "/api/projects/doomed/evict",
    });
    srv.stop();
  });

  test("reports closed:false when the server held nothing", async () => {
    const srv = withServer(() => Response.json({ ok: true, closed: false }));
    _setTestDeps({ port: srv.port });

    expect(await evictProjectFromServer("doomed")).toEqual({
      status: "evicted",
      closed: false,
    });
    srv.stop();
  });

  test("percent-encodes the slug rather than letting it shape the path", async () => {
    const srv = withServer(() => Response.json({ ok: true, closed: false }));
    _setTestDeps({ port: srv.port });

    await evictProjectFromServer("a/../b");

    // A slug reaching the registry with a slash in it would otherwise address a
    // different route entirely. The server decodes it back to a cache key.
    expect(srv.requests[0]!.pathname).toBe("/api/projects/a%2F..%2Fb/evict");
    srv.stop();
  });

  test("surfaces the server's error message on a refusal", async () => {
    const srv = withServer(() =>
      Response.json({ error: "still registered", reason: "still-registered" }, { status: 409 }),
    );
    _setTestDeps({ port: srv.port });

    expect(await evictProjectFromServer("doomed")).toEqual({
      status: "refused",
      message: "still registered",
    });
    srv.stop();
  });

  test("falls back to the status code when the error body is not JSON", async () => {
    const srv = withServer(() => new Response("kaboom", { status: 500 }));
    _setTestDeps({ port: srv.port });

    expect(await evictProjectFromServer("doomed")).toEqual({
      status: "refused",
      message: "HTTP 500",
    });
    srv.stop();
  });

  test("reports no-server when nothing is listening", async () => {
    // Lease a port and immediately release it, so the address is real but dead.
    const srv = withServer(() => new Response("unused"));
    const deadPort = srv.port;
    srv.stop();
    _setTestDeps({ port: deadPort });

    // The ordinary case: `project remove` from a shell with no dashboard up.
    expect(await evictProjectFromServer("doomed")).toEqual({ status: "no-server" });
  });

  test("gives up rather than hanging on a wedged server", async () => {
    const srv = withServer(() => Bun.sleep(30_000).then(() => new Response("late")));
    _setTestDeps({ port: srv.port, timeoutMs: 50 });

    // The project is already removed by the time this runs, so waiting on an
    // unresponsive server would only hold the command open for nothing.
    expect(await evictProjectFromServer("doomed")).toEqual({ status: "no-server" });
    srv.stop();
  });
});
