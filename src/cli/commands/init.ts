import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { register } from "@/cli/router";
import { runMigrations } from "@/db/migrate";
import { installHookScripts } from "@/hooks/install";
import { installHookSettings } from "@/hooks/settings";
import { paths } from "@/lib/paths";
import { generateCompletions } from "@/lib/completions";

interface BertrandConfig {
  terminal: "wave" | "other";
  bin: string;
  version: number;
}

function detectTerminal(): "wave" | "other" {
  try {
    execSync("which wsh", { stdio: "ignore" });
    return "wave";
  } catch {
    return "other";
  }
}

const CONFIG_PATH = join(paths.root, "config.json");

function writeConfig(config: BertrandConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function readConfig(): Partial<BertrandConfig> | null {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

const SOURCE_ENTRY = /\/src\/index\.tsx?$/;

/**
 * Resolve the absolute command hooks should invoke for `bertrand …`.
 *
 * - Installed (bun i -g / npm i -g): `Bun.which("bertrand")` returns the shim path.
 * - Source-tree dev: synthesize a launcher at ~/.bertrand/bin/bertrand-dev that
 *   execs the current source via bun, so hooks have a stable single-token path
 *   even when there's no global install.
 * - Otherwise: null, and init aborts with install instructions.
 */
function resolveBin(): string | null {
  const onPath = Bun.which("bertrand");
  if (onPath) return onPath;

  const entry = process.argv[1];
  if (entry && SOURCE_ENTRY.test(entry)) {
    const launcherDir = join(paths.root, "bin");
    const launcher = join(launcherDir, "bertrand-dev");
    mkdirSync(launcherDir, { recursive: true });
    writeFileSync(
      launcher,
      `#!/usr/bin/env bash\nexec ${process.execPath} ${JSON.stringify(entry)} "$@"\n`,
    );
    chmodSync(launcher, 0o755);
    return launcher;
  }

  return null;
}

register("init", async () => {
  console.log("bertrand init\n");

  // 1. Ensure directories
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.hooks, { recursive: true });

  // 2. Migrations
  runMigrations();
  console.log(`  Database: ${paths.db}`);

  // 3. Resolve binary path for hooks to invoke
  const bin = resolveBin();
  if (!bin) {
    console.error(
      "\nError: couldn't locate the bertrand binary on PATH.\n" +
        "Install it globally first:\n" +
        "  bun i -g bertrand    # or: npm i -g bertrand\n" +
        "Then re-run `bertrand init`.",
    );
    process.exit(1);
  }
  console.log(`  Bin:      ${bin}`);

  // 4. Config (preserve existing overrides; fill in detected/resolved values)
  const existing = readConfig();
  const terminal = existing?.terminal ?? detectTerminal();
  const config: BertrandConfig = {
    ...existing,
    terminal,
    bin,
    version: 1,
  };
  writeConfig(config);
  console.log(`  Terminal: ${terminal}${existing?.terminal ? "" : " (auto-detected)"}`);

  // 5. Hooks
  installHookScripts(bin);
  installHookSettings();

  // 6. Completions
  generateCompletions();

  console.log("\nDone. Run `bertrand` to get started.");
});
