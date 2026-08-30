import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "@/db/schema";
import { _setDb, _clearTestDb } from "@/db/client";
import { emitClaudeStarted } from "@/db/events/emit";
import { createCategory } from "@/db/queries/categories";
import { createSession, getSession, updateSession } from "@/db/queries/sessions";
import type { SessionRow } from "@/types";
import { startServer } from "./index";

/**
 * Route-level coverage for the per-session POST endpoints.
 *
 * These exist because the library functions behind them were already tested
 * (`session-archive.test.ts`) while nothing asserted they were *reachable* — so
 * the worktree teardown (ELKY-163) could delete the archive/unarchive route
 * blocks, which sat between two worktree blocks in the same `if (POST)`, and
 * leave a green suite behind. The dashboard 404'd on every archive.
 *
 * The distinction each test turns on: the router's own miss answers
 * `{"error":"Not found"}`, a dispatched handler answers something else. Assert
 * the handler's reply, never just "not 200".
 */

const TEST_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "bertrand-sessions-api-")),
  "test.db",
);
const sqlite = new Database(TEST_DB_PATH);
sqlite.exec("PRAGMA foreign_keys = ON");
// A process-wide override: `getDbForProject` bypasses its per-project cache
// while one is installed, so every `?project=` scope the routes resolve lands
// here rather than in `~/.bertrand`.
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "db", "migrations"),
});

let server: ReturnType<typeof startServer>;
const originalWorkspace = process.env.BERTRAND_WORKSPACE;

beforeAll(() => {
  // startServer's boot sweep is global and would reconcile the real machine's
  // sessions. It's gated on BERTRAND_WORKSPACE.
  process.env.BERTRAND_WORKSPACE = "1";
  // Port 0 leases an ephemeral port, so a busy 5200 can't flake the suite.
  server = startServer(0);
});

afterAll(() => {
  server.stop(true);
  // The `_setDb` override is process-wide, so leaving it installed would hand
  // this file's handle to whichever suite runs next.
  _clearTestDb();
  if (originalWorkspace === undefined) {
    delete process.env.BERTRAND_WORKSPACE;
  } else {
    process.env.BERTRAND_WORKSPACE = originalWorkspace;
  }
});

const post = (path: string) =>
  fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST" });

let seq = 0;
function makeSession(): SessionRow {
  const n = seq++;
  const cat = createCategory({ slug: `api-cat-${n}`, name: `api ${n}` });
  return createSession({
    categoryId: cat.id,
    slug: `api-session-${n}`,
    name: `api session ${n}`,
  });
}

describe("POST /api/sessions/:id/archive", () => {
  test("archives the session", async () => {
    const s = makeSession();

    const res = await post(`/api/sessions/${s.id}/archive`);

    expect(res.status).toBe(200);
    expect(getSession(s.id)!.status).toBe("archived");
  });

  test("is routed — an unknown id reaches the handler, not the router's miss", async () => {
    const res = await post("/api/sessions/does-not-exist/archive");

    // The router's own 404 says "Not found"; this one is the handler's.
    expect((await res.json()) as { error?: string }).toMatchObject({
      error: "Session not found",
    });
  });

  test("refuses an active session with its own reason", async () => {
    const s = makeSession();
    updateSession(s.id, { status: "active" });

    const res = await post(`/api/sessions/${s.id}/archive`);

    expect(res.status).toBe(409);
    expect((await res.json()) as { reason?: string }).toMatchObject({
      reason: "active",
    });
  });
});

describe("POST /api/sessions/:id/unarchive", () => {
  test("restores an archived session", async () => {
    const s = makeSession();
    await post(`/api/sessions/${s.id}/archive`);

    const res = await post(`/api/sessions/${s.id}/unarchive`);

    expect(res.status).toBe(200);
    expect(getSession(s.id)!.status).not.toBe("archived");
  });

  test("is routed — an unknown id reaches the handler", async () => {
    const res = await post("/api/sessions/does-not-exist/unarchive");

    expect((await res.json()) as { error?: string }).toMatchObject({
      error: "Session not found",
    });
  });
});

describe("POST /api/sessions/:id/resume — legacy worktree rows", () => {
  // The teardown removed the `worktree_path` arm from `resolveSessionCwd`.
  // Nothing writes that column any more, but existing rows still carry one —
  // acquired two ways that left different records, which is why the guard
  // compares rather than checking presence. Both arms are covered here.
  //
  // Two real directories: `resolveSessionCwd` calls `existsSync` on the
  // recorded cwd, so a fabricated path would fail as `no-cwd` and the test
  // would pass for the wrong reason.
  const mainCheckout = mkdtempSync(join(tmpdir(), "bertrand-checkout-"));
  const worktreeDir = mkdtempSync(join(tmpdir(), "bertrand-worktree-"));

  afterAll(() => {
    rmSync(mainCheckout, { recursive: true, force: true });
    rmSync(worktreeDir, { recursive: true, force: true });
  });

  test("refuses when the row disagrees with the event (EnterWorktree)", async () => {
    // The dangerous shape: the hook wrote the column mid-run without emitting a
    // fresh `claude.started`, so the event names the main checkout. Resuming
    // there would commit the session's work to the wrong branch.
    const s = makeSession();
    emitClaudeStarted({ sessionId: s.id, cwd: mainCheckout });
    updateSession(s.id, {
      worktreePath: worktreeDir,
      worktreeBranch: "worktree-legacy",
    });

    const res = await post(`/api/sessions/${s.id}/resume`);

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason?: string; error?: string };
    expect(body.reason).toBe("worktree-gone");
    expect(body.error).toContain("wrong branch");
  });

  test("allows a row whose event already names the worktree (dashboard spawn)", async () => {
    // #210 started `claude` *in* the worktree, so the recorded cwd was right all
    // along. Refusing on presence alone would turn these away for no reason.
    const s = makeSession();
    emitClaudeStarted({ sessionId: s.id, cwd: worktreeDir });
    updateSession(s.id, {
      worktreePath: worktreeDir,
      worktreeBranch: "worktree-spawned",
    });

    const res = await post(`/api/sessions/${s.id}/resume`);

    // Not the worktree refusal. It fails later for want of a conversation to
    // attach to, which is this fixture's shape, not the guard's doing.
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).not.toBe("worktree-gone");
  });
});
