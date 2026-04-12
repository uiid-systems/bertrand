import type { TerminalAdapter } from "./adapter.ts";
import { WaveAdapter } from "./wave.ts";
import { NoopAdapter } from "./noop.ts";
import { readFileSync } from "fs";
import { join } from "path";
import { paths } from "../lib/paths.ts";

let cachedAdapter: TerminalAdapter | null = null;

/**
 * Get the terminal adapter based on config or auto-detection.
 * Cached after first call.
 */
export function getTerminalAdapter(): TerminalAdapter {
  if (cachedAdapter) return cachedAdapter;

  // Check config for terminal type
  const configType = readConfigTerminal();

  if (configType === "wave") {
    cachedAdapter = new WaveAdapter();
    return cachedAdapter;
  }

  // Auto-detect
  const wave = new WaveAdapter();
  if (wave.detect()) {
    cachedAdapter = wave;
    return cachedAdapter;
  }

  cachedAdapter = new NoopAdapter();
  return cachedAdapter;
}

function readConfigTerminal(): string | null {
  try {
    const config = JSON.parse(readFileSync(join(paths.root, "config.json"), "utf-8"));
    return config.terminal ?? null;
  } catch {
    return null;
  }
}

export type { TerminalAdapter } from "./adapter.ts";
