import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveWorkspace } from "@/lib/workspace/resolve";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-resolve-"));
  dirs.push(dir);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

const pkg = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ scripts: { dev: "vite" }, ...extra });

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("resolveWorkspace", () => {
  test("zero-config: lockfile + scripts.dev → detected run + install setup", () => {
    const dir = fixture({ "package.json": pkg(), "bun.lock": "" });
    expect(resolveWorkspace(dir)).toEqual({
      scripts: { run: "bun run dev", setup: "bun install", archive: undefined },
      packageManager: "bun",
      source: "detected",
    });
  });

  test("falls back to npm for the run/setup when no lockfile pins a manager", () => {
    const dir = fixture({ "package.json": pkg() });
    expect(resolveWorkspace(dir)).toEqual({
      scripts: { run: "npm run dev", setup: undefined, archive: undefined },
      packageManager: null,
      source: "detected",
    });
  });

  test("returns null when there is nothing to run", () => {
    expect(resolveWorkspace(fixture({}))).toBeNull();
    expect(
      resolveWorkspace(fixture({ "package.json": JSON.stringify({ scripts: { build: "x" } }) })),
    ).toBeNull();
  });

  test("a committed run override wins over detection and reports source 'override'", () => {
    const dir = fixture({
      "package.json": pkg({ bertrand: { run: "next dev --port $BERTRAND_PORT" } }),
      "pnpm-lock.yaml": "",
    });
    const cfg = resolveWorkspace(dir)!;
    expect(cfg.scripts.run).toBe("next dev --port $BERTRAND_PORT");
    expect(cfg.source).toBe("override");
    // setup still auto-defaults to the detected manager's install
    expect(cfg.scripts.setup).toBe("pnpm install");
  });

  test("devCommand is an alias for run; run wins when both are present", () => {
    const aliasOnly = fixture({
      "package.json": JSON.stringify({ bertrand: { devCommand: "vite --host" } }),
    });
    expect(resolveWorkspace(aliasOnly)?.scripts.run).toBe("vite --host");

    const both = fixture({
      "package.json": JSON.stringify({ bertrand: { run: "real", devCommand: "alias" } }),
    });
    expect(resolveWorkspace(both)?.scripts.run).toBe("real");
  });

  test("override can supply setup and archive", () => {
    const dir = fixture({
      ".bertrand/config.json": JSON.stringify({
        run: "vite",
        setup: "pnpm i && ln -s ../.env .env",
        archive: "docker compose down",
      }),
      "pnpm-lock.yaml": "",
    });
    expect(resolveWorkspace(dir)?.scripts).toEqual({
      run: "vite",
      setup: "pnpm i && ln -s ../.env .env",
      archive: "docker compose down",
    });
  });

  test("an override with only run/devCommand does not fabricate a preview from a dev-less project", () => {
    // No scripts.dev, but the committed override provides the run command.
    const dir = fixture({
      "package.json": JSON.stringify({ bertrand: { run: "make serve" } }),
    });
    expect(resolveWorkspace(dir)?.scripts.run).toBe("make serve");
  });

  test("api sidecar is override-only: never auto-detected, passed through when committed", () => {
    const detected = fixture({ "package.json": pkg(), "bun.lock": "" });
    expect(resolveWorkspace(detected)?.scripts.api).toBeUndefined();

    const overridden = fixture({
      "package.json": pkg({
        bertrand: { run: "vite", api: "bun run src/index.ts serve" },
      }),
      "bun.lock": "",
    });
    expect(resolveWorkspace(overridden)?.scripts.api).toBe(
      "bun run src/index.ts serve",
    );
  });
});
