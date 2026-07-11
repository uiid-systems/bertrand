import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { installHookScripts, hookScriptsAreCurrent } from "./install";
import { HOOK_SCRIPTS } from "./scripts";

const BIN = "/usr/local/bin/bertrand-test";

let hooksDir: string;
let runtimeDir: string;

beforeEach(() => {
  const workDir = mkdtempSync(join(tmpdir(), "bertrand-install-"));
  hooksDir = join(workDir, "hooks");
  runtimeDir = join(workDir, "run");
});

afterEach(() => {
  rmSync(join(hooksDir, ".."), { recursive: true, force: true });
});

describe("installHookScripts", () => {
  test("writes every script executable, rendered with the given bin", () => {
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });

    for (const [filename, scriptFn] of Object.entries(HOOK_SCRIPTS)) {
      const filePath = join(hooksDir, filename);
      expect(readFileSync(filePath, "utf-8")).toBe(scriptFn(BIN, runtimeDir));
      expect(statSync(filePath).mode & 0o111).toBeTruthy();
    }
  });
});

describe("hookScriptsAreCurrent", () => {
  test("false before any install, true right after", () => {
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(false);
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(true);
  });

  test("false when the bin path changes (binary moved/upgraded install)", () => {
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    expect(
      hookScriptsAreCurrent("/opt/other/bertrand", { dir: hooksDir, runtimeDir }),
    ).toBe(false);
  });

  test("false when an installed script drifts from the embedded content", () => {
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    const victim = join(hooksDir, Object.keys(HOOK_SCRIPTS)[0]!);
    writeFileSync(victim, "#!/usr/bin/env bash\n# stale content from a previous binary\n");
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(false);
  });

  test("false when a script file is missing", () => {
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    rmSync(join(hooksDir, Object.keys(HOOK_SCRIPTS)[0]!));
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(false);
  });

  test("orphaned scripts from retired hooks flag drift and are pruned on install", () => {
    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    const orphan = join(hooksDir, "on-retired.sh");
    writeFileSync(orphan, "#!/usr/bin/env bash\n");
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(false);

    installHookScripts(BIN, { quiet: true, dir: hooksDir, runtimeDir });
    expect(existsSync(orphan)).toBe(false);
    expect(hookScriptsAreCurrent(BIN, { dir: hooksDir, runtimeDir })).toBe(true);
  });
});
