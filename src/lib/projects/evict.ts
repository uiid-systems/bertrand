/**
 * Tell a running `bertrand serve` that a project is gone (issue #249).
 *
 * Removing a project is a registry write plus a cache drop, and both only
 * affect the process that ran the command — a CLI invocation that is about to
 * exit. The dashboard server is long-lived, keeps its own per-project DB cache,
 * and holds its own descriptors on every project DB it has served. Nothing in
 * the removal path crossed that process boundary, so the server kept serving
 * from a project that no longer existed and kept its files open. Under
 * `--purge` that is the difference between reporting success and actually
 * reclaiming the disk space.
 */

/**
 * Narrowed to the one call shape this module makes. `typeof fetch` would carry
 * Bun's `preconnect` along with it and force every test stub to implement a
 * method that has nothing to do with eviction.
 */
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface Deps {
  port: number;
  /**
   * Cap on how long the CLI will wait for the server to answer. Removal has
   * already happened by the time we call, so a server that is wedged must
   * degrade to a hint rather than hold the command open.
   */
  timeoutMs: number;
  fetch: FetchLike;
}

const defaultDeps: Deps = {
  port: Number(process.env.BERTRAND_PORT ?? 5200),
  timeoutMs: 1_000,
  fetch: (url, init) => globalThis.fetch(url, init),
};

let deps: Deps = defaultDeps;

/** Test-only seam: swap any subset of the dependencies. */
export function _setTestDeps(override: Partial<Deps>): void {
  deps = { ...defaultDeps, ...override };
}

/** Test-only seam: restore production deps. */
export function _resetTestDeps(): void {
  deps = defaultDeps;
}

export type EvictResult =
  /** Nothing was listening — the ordinary case for a plain CLI invocation. */
  | { status: "no-server" }
  /** The server accepted; `closed` reports whether it actually held a handle. */
  | { status: "evicted"; closed: boolean }
  /** A server answered but declined. The caller should surface `message`. */
  | { status: "refused"; message: string };

/**
 * Ask the local server to release a removed project's DB handles.
 *
 * Deliberately probes the port rather than consulting `server.pid`: when the
 * user runs `bertrand serve` themselves (the dashboard dev script does), no PID
 * file is ever written, and that server pins descriptors exactly the same way.
 * A refused connection is the answer to "is one running", and it comes back
 * immediately on loopback.
 *
 * Never throws — the project is already removed by the time this runs, so a
 * failure here degrades the outcome to "space is reclaimed on next restart"
 * rather than failing the command.
 */
export async function evictProjectFromServer(slug: string): Promise<EvictResult> {
  let res: Response;
  try {
    res = await deps.fetch(
      `http://127.0.0.1:${deps.port}/api/projects/${encodeURIComponent(slug)}/evict`,
      { method: "POST", signal: AbortSignal.timeout(deps.timeoutMs) },
    );
  } catch {
    return { status: "no-server" };
  }

  if (!res.ok) {
    const message = await res
      .json()
      .then((body: unknown) =>
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : `HTTP ${res.status}`,
      )
      .catch(() => `HTTP ${res.status}`);
    return { status: "refused", message };
  }

  const closed = await res
    .json()
    .then((body: unknown) => (body as { closed?: unknown })?.closed === true)
    .catch(() => false);
  return { status: "evicted", closed };
}
