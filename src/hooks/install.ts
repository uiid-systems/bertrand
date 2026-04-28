import { mkdirSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { paths } from "@/lib/paths";
import { HOOK_SCRIPTS } from "./scripts";

/** Write all hook scripts to ~/.bertrand/hooks/ with +x permissions */
export function installHookScripts() {
  mkdirSync(paths.hooks, { recursive: true });

  for (const [filename, scriptFn] of Object.entries(HOOK_SCRIPTS)) {
    const filePath = join(paths.hooks, filename);
    writeFileSync(filePath, scriptFn());
    chmodSync(filePath, 0o755);
  }

  console.log(`Installed ${Object.keys(HOOK_SCRIPTS).length} hook scripts to ${paths.hooks}`);
}
