import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectPackageManager,
  installCommand,
  readPackageJson,
  runScriptCommand,
} from "@/lib/workspace/detect";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-detect-"));
  dirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
  test("detects each manager from its lockfile", () => {
    expect(detectPackageManager(fixture({ "bun.lock": "" }))).toBe("bun");
    expect(detectPackageManager(fixture({ "bun.lockb": "" }))).toBe("bun");
    expect(detectPackageManager(fixture({ "pnpm-lock.yaml": "" }))).toBe("pnpm");
    expect(detectPackageManager(fixture({ "yarn.lock": "" }))).toBe("yarn");
    expect(detectPackageManager(fixture({ "package-lock.json": "" }))).toBe("npm");
  });

  test("returns null when no lockfile is present", () => {
    expect(detectPackageManager(fixture({ "package.json": "{}" }))).toBeNull();
  });

  test("prefers the more specific manager when multiple lockfiles exist", () => {
    // A stray package-lock.json in a bun project must not shadow bun.
    const dir = fixture({ "bun.lock": "", "package-lock.json": "" });
    expect(detectPackageManager(dir)).toBe("bun");
  });
});

describe("readPackageJson", () => {
  test("parses a valid package.json", () => {
    const dir = fixture({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }) });
    expect(readPackageJson(dir)?.scripts?.dev).toBe("vite");
  });

  test("returns null when missing or unparseable", () => {
    expect(readPackageJson(fixture({}))).toBeNull();
    expect(readPackageJson(fixture({ "package.json": "{ not json" }))).toBeNull();
  });
});

describe("runScriptCommand", () => {
  test("maps each manager to its run form", () => {
    expect(runScriptCommand("bun", "dev")).toBe("bun run dev");
    expect(runScriptCommand("pnpm", "dev")).toBe("pnpm run dev");
    expect(runScriptCommand("yarn", "dev")).toBe("yarn dev");
    expect(runScriptCommand("npm", "dev")).toBe("npm run dev");
  });
});

describe("installCommand", () => {
  test("is <pm> install for every manager", () => {
    expect(installCommand("bun")).toBe("bun install");
    expect(installCommand("pnpm")).toBe("pnpm install");
    expect(installCommand("yarn")).toBe("yarn install");
    expect(installCommand("npm")).toBe("npm install");
  });
});
