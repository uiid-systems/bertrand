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

export function patchConfig(patch: Partial<BertrandConfig>): Partial<BertrandConfig> {
  const current = readConfig() ?? {};
  const next = { ...current, ...patch };
  writeConfig(next);
  return next;
}

export function isSyncEnabled(): boolean {
  return readConfig()?.sync?.enabled === true;
}
