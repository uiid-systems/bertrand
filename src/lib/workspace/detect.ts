import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PackageManager } from "./types";

/**
 * Lockfile → package manager, highest precedence first. A repo can carry more
 * than one lockfile (e.g. a stray `package-lock.json` in a bun project); the
 * order here mirrors what most tooling assumes — the more specific/opinionated
 * managers win over npm's default.
 */
const LOCKFILES: [PackageManager, string[]][] = [
  ["bun", ["bun.lock", "bun.lockb"]],
  ["pnpm", ["pnpm-lock.yaml"]],
  ["yarn", ["yarn.lock"]],
  ["npm", ["package-lock.json"]],
];

/**
 * Detect the package manager for a directory from its lockfile. Returns null
 * when no lockfile is present — the caller decides on a fallback (resolve()
 * uses npm, which is universally available).
 */
export function detectPackageManager(dir: string): PackageManager | null {
  for (const [pm, files] of LOCKFILES) {
    if (files.some((f) => existsSync(join(dir, f)))) return pm;
  }
  return null;
}

interface PackageJson {
  scripts?: Record<string, string>;
  bertrand?: unknown;
}

/**
 * Read and parse `package.json` from a directory. Returns null when the file
 * is missing or unparseable — a non-node worktree simply has no dev command
 * to detect, which resolve() treats as "not previewable".
 */
export function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
  } catch {
    return null;
  }
}

/** The command that runs a named package.json script under a given manager. */
export function runScriptCommand(pm: PackageManager, script: string): string {
  switch (pm) {
    case "bun":
      return `bun run ${script}`;
    case "pnpm":
      return `pnpm run ${script}`;
    // Classic yarn invokes scripts directly (`yarn dev`); `yarn run dev`
    // is also accepted, but the bare form is the idiomatic one.
    case "yarn":
      return `yarn ${script}`;
    case "npm":
      return `npm run ${script}`;
  }
}

/** The command that installs dependencies under a given manager. */
export function installCommand(pm: PackageManager): string {
  return `${pm} install`;
}
