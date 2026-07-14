import {
  detectPackageManager,
  installCommand,
  readPackageJson,
  runScriptCommand,
} from "./detect";
import { readRepoWorkspaceConfig } from "./config";
import type { WorkspaceRunConfig } from "./types";

/**
 * Resolve how to preview a workspace directory, or null when it can't be.
 *
 * Precedence for the `run` command:
 *   1. a committed override (`run`, else its `devCommand` alias) — source "override"
 *   2. auto-detected `package.json` `scripts.dev` under the detected package
 *      manager (npm when no lockfile pins one) — source "detected"
 * With neither, there is no dev server to launch, so we return null and the
 * session simply doesn't get a preview.
 *
 * `setup` and `archive` come from the override when present; otherwise `setup`
 * defaults to the package manager's install command (nothing to archive by
 * default). This is the zero-config frontend path: a lockfile + a `dev` script
 * is enough to install and run with no committed config at all.
 *
 * `api` is override-only: an API sidecar has no auto-detectable shape, so a
 * workspace only gets one when the repo commits the command.
 */
export function resolveWorkspace(dir: string): WorkspaceRunConfig | null {
  const override = readRepoWorkspaceConfig(dir);
  const pm = detectPackageManager(dir);
  const pkg = readPackageJson(dir);

  const overrideRun = override?.run ?? override?.devCommand;

  let run: string;
  let source: WorkspaceRunConfig["source"];
  if (overrideRun) {
    run = overrideRun;
    source = "override";
  } else if (pkg?.scripts?.dev) {
    // No lockfile → fall back to npm, which is universally present.
    run = runScriptCommand(pm ?? "npm", "dev");
    source = "detected";
  } else {
    return null;
  }

  const setup = override?.setup ?? (pm ? installCommand(pm) : undefined);

  return {
    scripts: { run, setup, api: override?.api, archive: override?.archive },
    packageManager: pm,
    source,
  };
}
