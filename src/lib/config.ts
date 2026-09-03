import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

export interface BertrandConfig {
  bin: string;
  version: number;
  sync?: {
    enabled: boolean;
  };
  /**
   * Record claude sessions started outside bertrand, from their second prompt
   * on, without anyone running `bertrand adopt`.
   *
   * Off unless the user turns it on. The cost of being wrong is asymmetric:
   * someone who wants everything captured says so once, while a machine that
   * has not asked stays untouched — and opt-in is what keeps auto-creation
   * from re-opening the curation question the TUI's launch step used to answer
   * (`docs/session-identity.md`, "Drift: the required position").
   *
   * This was a per-project flag while projects existed. It is global now
   * because the thing it was attached to is gone: a cwd resolves to a repo,
   * and no repo is registered anywhere to hang a preference on. The narrower
   * gate is still available — a repo bertrand cannot resolve at all is refused
   * regardless of this flag.
   */
  autoAdopt?: boolean;
  github?: {
    /**
     * Hosts trusted to serve GitHub Enterprise Server. github.com needs no
     * entry; anything else is not a GitHub remote until it appears here.
     * A port is part of the host: `github.acme.com:8443` is its own entry.
     */
    enterpriseHosts?: string[];
  };
}

/**
 * Resolved through `paths.root` rather than composed here, so a test that
 * calls `_setRootDir(tmp)` cannot end up writing to the developer's real
 * ~/.bertrand/config.json. Production behaviour is identical.
 */
function configPath(): string {
  return join(paths.root, "config.json");
}

export function readConfig(): Partial<BertrandConfig> | null {
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8"));
  } catch {
    return null;
  }
}

export function writeConfig(config: Partial<BertrandConfig>): void {
  // Ensure ~/.bertrand exists before writing. Normally `bertrand init`
  // creates it, but writeConfig can be the FIRST thing to touch the dir
  // when a user imports a sync bundle on a fresh machine that has no prior
  // bertrand state.
  mkdirSync(paths.root, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
}

/**
 * Deep-merge a partial config patch into ~/.bertrand/config.json. Nested
 * objects (e.g. `sync: {...}`) are merged key-by-key rather than replaced
 * wholesale, so a caller that only sets `sync.enabled` doesn't clobber
 * other keys some other code added to `sync`. Arrays and primitives at
 * any depth are replaced as-is. Returns the resulting config.
 */
export function patchConfig(patch: Partial<BertrandConfig>): Partial<BertrandConfig> {
  const current = readConfig() ?? {};
  const next = deepMerge(current, patch);
  writeConfig(next);
  return next;
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    if (isPlainObject(existing) && isPlainObject(v)) {
      out[k] = deepMerge(existing, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isSyncEnabled(): boolean {
  return readConfig()?.sync?.enabled === true;
}

/**
 * Whether automatic adoption may run on this machine. Default false, and
 * `=== true` rather than truthiness so a stray string in a hand-edited
 * config.json cannot switch it on.
 */
export function isAutoAdoptEnabled(): boolean {
  return readConfig()?.autoAdopt === true;
}
