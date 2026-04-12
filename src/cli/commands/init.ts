import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { register } from "../router.ts";
import { installHookScripts } from "../../hooks/install.ts";
import { installHookSettings } from "../../hooks/settings.ts";
import { paths } from "../../lib/paths.ts";
import { generateCompletions } from "../../lib/completions.ts";

interface BertrandConfig {
  terminal: "wave" | "other";
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

function writeConfig(config: BertrandConfig) {
  const configPath = join(paths.root, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Config written to ${configPath}`);
}

function readConfig(): BertrandConfig | null {
  const configPath = join(paths.root, "config.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

register("init", async () => {
  console.log("bertrand init\n");

  // 1. Ensure directories
  mkdirSync(paths.root, { recursive: true });
  mkdirSync(paths.hooks, { recursive: true });

  // 2. Config
  const existing = readConfig();
  const terminal = detectTerminal();
  const config: BertrandConfig = {
    terminal,
    version: 1,
    ...existing, // preserve existing overrides
    // only set terminal if not already configured
    ...(existing?.terminal ? {} : { terminal }),
  };
  writeConfig(config);
  console.log(`  Terminal: ${config.terminal}${config.terminal === "wave" ? " (auto-detected)" : ""}`);

  // 3. Hooks
  installHookScripts();
  installHookSettings();

  // 4. Completions
  generateCompletions();

  console.log("\nDone. Run `bertrand` to get started.");
});
