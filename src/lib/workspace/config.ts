import { readFileSync } from "fs";
import { join } from "path";
import { readPackageJson } from "./detect";
import type { RepoWorkspaceConfig } from "./types";

/**
 * Read the repo-committed workspace override for a directory, if any.
 *
 * Two sources, merged with the dedicated file winning key-by-key:
 *   1. the `bertrand` key in `package.json` (convenient, no extra file)
 *   2. `.bertrand/config.json` (dedicated, for teams that keep it out of
 *      package.json)
 *
 * Returns null when neither source contributes a recognized key, so callers
 * can cheaply distinguish "no override" from "empty override". Unknown keys
 * are ignored; malformed JSON is treated as absent rather than throwing —
 * a broken config file should degrade to auto-detection, not break previews.
 */
export function readRepoWorkspaceConfig(dir: string): RepoWorkspaceConfig | null {
  const fromPkg = pick(readPackageJson(dir)?.bertrand);
  const fromFile = pick(readJsonFile(join(dir, ".bertrand", "config.json")));

  if (!fromPkg && !fromFile) return null;
  return { ...fromPkg, ...fromFile };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Extract only the recognized override keys from an untrusted object, keeping
 * string values. Returns null when nothing usable is present so the merge in
 * the caller stays clean.
 */
function pick(raw: unknown): RepoWorkspaceConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const src = raw as Record<string, unknown>;
  const out: RepoWorkspaceConfig = {};
  for (const key of ["setup", "run", "api", "archive", "devCommand"] as const) {
    if (typeof src[key] === "string") out[key] = src[key] as string;
  }
  return Object.keys(out).length > 0 ? out : null;
}
