import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { _getRegistryDir } from "@/lib/projects/registry";

export interface BertrandConfig {
  terminal: "wave" | "other";
  bin: string;
  version: number;
  sync?: {
    enabled: boolean;
  };
}

/**
 * Resolve via `_getRegistryDir()` (same knob projects/paths.ts uses) so
 * a test that calls `_setRegistryDir(tmp)` doesn't end up writing to the
 * developer's real ~/.bertrand/config.json. Production behavior is
 * identical: the registry dir defaults to ~/.bertrand.
 */
function configPath(): string {
  return join(_getRegistryDir(), "config.json");
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
  // when a user imports a project via `bertrand sync <bundle>` on a
  // fresh machine that has no prior bertrand state.
  mkdirSync(_getRegistryDir(), { recursive: true });
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
