import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";

export interface BertrandConfig {
  terminal: "wave" | "other";
  bin: string;
  version: number;
  sync?: {
    enabled: boolean;
  };
}

const CONFIG_PATH = join(paths.root, "config.json");

export function readConfig(): Partial<BertrandConfig> | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

export function writeConfig(config: Partial<BertrandConfig>): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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
