import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

/**
 * Deterministic per-session preview ports (docs/workspaces.md, Phase 1B).
 *
 * Each session gets one stable port for the life of its worktree, persisted
 * in a small registry so the same session resolves to the same port across
 * processes (the hook that starts the server and `bertrand open` must agree).
 *
 * The preferred slot is a hash of the session id, so ports are stable and
 * spread out even before the registry exists; a linear probe from there
 * resolves the rare collision. The range deliberately avoids the common dev
 * ports (3000, 5173, 5200 — bertrand serve, 8080).
 */
const RANGE_BASE = 4700;
const RANGE_SIZE = 200; // 4700..4899

type PortRegistry = Record<string, number>;

interface Deps {
  registryDir: string;
}

const defaultDeps: Deps = { registryDir: join(paths.root, "workspaces") };
let deps: Deps = defaultDeps;

/** Test-only seam: point the registry at a temp dir. */
export function _setPortDeps(override: Partial<Deps>): void {
  deps = { ...defaultDeps, ...override };
}

/** Test-only seam: restore production deps. */
export function _resetPortDeps(): void {
  deps = defaultDeps;
}

function registryPath(): string {
  return join(deps.registryDir, "ports.json");
}

function read(): PortRegistry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath(), "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as PortRegistry) : {};
  } catch {
    return {};
  }
}

function write(reg: PortRegistry): void {
  mkdirSync(deps.registryDir, { recursive: true });
  // Atomic replace: two processes write this registry (the dashboard server
  // and the CLI). A plain write can be seen torn by a concurrent reader,
  // which parses as {} — and the next write would then persist an empty
  // registry, silently dropping every allocation. Rename never exposes a
  // partial file. (The pid in the temp name keeps concurrent writers from
  // clobbering each other's temp file.)
  const tmp = `${registryPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n");
  renameSync(tmp, registryPath());
}

/** djb2 — small, stable string hash. Only needs to spread ids across the range. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Return the session's port, allocating (and persisting) one on first call.
 * Idempotent: a session that already holds a port always gets the same one.
 * Throws only if every port in the range is taken.
 */
export function allocatePort(sessionId: string): number {
  const reg = read();
  const existing = reg[sessionId];
  if (existing) return existing;

  const taken = new Set(Object.values(reg));
  const start = hash(sessionId) % RANGE_SIZE;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const port = RANGE_BASE + ((start + i) % RANGE_SIZE);
    if (!taken.has(port)) {
      reg[sessionId] = port;
      write(reg);
      return port;
    }
  }
  throw new Error(
    `no free preview port in ${RANGE_BASE}..${RANGE_BASE + RANGE_SIZE - 1} (${taken.size} in use)`,
  );
}

/**
 * Registry key for a session's API-sidecar port. The registry maps arbitrary
 * string keys to ports, so the second per-session slot is just a derived key;
 * session ids are nanoids (no `:`), so the suffix can't collide with a real
 * id, and `prunePorts` treats the key as owned by the session.
 */
export function apiPortKey(sessionId: string): string {
  return `${sessionId}:api`;
}

/** The session's allocated port, or null if it has none. */
export function getPort(sessionId: string): number | null {
  return read()[sessionId] ?? null;
}

/** Release a session's port so the slot can be reused. */
export function releasePort(sessionId: string): void {
  const reg = read();
  if (reg[sessionId] === undefined) return;
  delete reg[sessionId];
  write(reg);
}

/**
 * Drop registry entries for sessions that are no longer active — reclaims
 * ports leaked by a session that died without a clean exit. Callers pass the
 * set of session ids that should keep their port.
 */
export function prunePorts(activeSessionIds: Iterable<string>): void {
  const keep = new Set(activeSessionIds);
  const reg = read();
  let changed = false;
  for (const key of Object.keys(reg)) {
    // A `<sessionId>:api` sidecar slot lives and dies with its session.
    const owner = key.split(":")[0]!;
    if (!keep.has(owner)) {
      delete reg[key];
      changed = true;
    }
  }
  if (changed) write(reg);
}
