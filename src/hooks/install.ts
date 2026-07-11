import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { readConfig } from "@/lib/config";
import { paths } from "@/lib/paths";
import { HOOK_SCRIPTS } from "./scripts";
import { hookSettingsAreCurrent, installHookSettings } from "./settings";

export interface InstallOptions {
  quiet?: boolean;
  /** Test override for ~/.bertrand/hooks. */
  dir?: string;
  /** Test override for ~/.bertrand/run (rendered into the scripts). */
  runtimeDir?: string;
}

/** Write all hook scripts to ~/.bertrand/hooks/ with +x permissions */
export function installHookScripts(bin: string, opts: InstallOptions = {}) {
  const dir = opts.dir ?? paths.hooks;
  const runtimeDir = opts.runtimeDir ?? paths.runtime;
  mkdirSync(dir, { recursive: true });
  // Marker scratch dir used by the hook scripts. Ensuring it here means
  // the scripts don't need a defensive `mkdir -p` on every fire.
  mkdirSync(runtimeDir, { recursive: true });

  for (const [filename, scriptFn] of Object.entries(HOOK_SCRIPTS)) {
    const filePath = join(dir, filename);
    // Write-then-rename: a reinstall can land while bash is mid-read of a
    // firing hook script; truncating the file in place would corrupt that
    // read, while rename leaves the old inode intact for the running shell.
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    writeFileSync(tmpPath, scriptFn(bin, runtimeDir));
    chmodSync(tmpPath, 0o755);
    renameSync(tmpPath, filePath);
  }

  for (const orphan of orphanScripts(dir)) {
    unlinkSync(join(dir, orphan));
    if (!opts.quiet) console.log(`  Removed retired hook script: ${orphan}`);
  }

  if (!opts.quiet) {
    console.log(`Installed ${Object.keys(HOOK_SCRIPTS).length} hook scripts to ${dir}`);
  }
}

/**
 * Script files from hooks that were renamed or retired. Nothing references
 * them once settings.json is rewritten, but leaving them around makes the
 * install state ambiguous (which of these actually fire?).
 */
function orphanScripts(dir: string): string[] {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  return files.filter((f) => f.endsWith(".sh") && !(f in HOOK_SCRIPTS));
}

/** True when every installed hook script matches what this binary would write. */
export function hookScriptsAreCurrent(bin: string, opts: InstallOptions = {}): boolean {
  const dir = opts.dir ?? paths.hooks;
  const runtimeDir = opts.runtimeDir ?? paths.runtime;
  for (const [filename, scriptFn] of Object.entries(HOOK_SCRIPTS)) {
    let installed: string;
    try {
      installed = readFileSync(join(dir, filename), "utf-8");
    } catch {
      return false;
    }
    if (installed !== scriptFn(bin, runtimeDir)) return false;
  }
  return orphanScripts(dir).length === 0;
}

/**
 * Self-heal installed hooks when they drift from this binary.
 *
 * The TS rebuild dropped the Go version's install-on-upgrade behavior, and a
 * binary upgrade alone doesn't refresh ~/.bertrand/hooks — stale scripts kept
 * calling the removed `assistant-message` command for a full day while the
 * `bq` wrapper swallowed every error. Running this on each hook tick (`update`)
 * and TUI launch closes that gap; the happy path is a handful of small reads.
 *
 * Guarded so only the process that *is* the configured binary heals: a source
 * checkout or test run must never overwrite the hooks the global install owns.
 * No-op until `bertrand init` has recorded a bin path.
 */
export function ensureHooksCurrent(): boolean {
  const bin = readConfig()?.bin;
  const self = process.argv[1];
  if (!bin || !self) return false;
  try {
    if (realpathSync(self) !== realpathSync(bin)) return false;
  } catch {
    return false;
  }
  if (hookScriptsAreCurrent(bin) && hookSettingsAreCurrent()) return false;
  installHookScripts(bin, { quiet: true });
  installHookSettings({ quiet: true });
  return true;
}
