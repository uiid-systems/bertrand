import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readRepoWorkspaceConfig } from "@/lib/workspace/config";

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-wsconfig-"));
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

describe("readRepoWorkspaceConfig", () => {
  test("returns null when neither source contributes a key", () => {
    expect(readRepoWorkspaceConfig(fixture({}))).toBeNull();
    expect(
      readRepoWorkspaceConfig(fixture({ "package.json": JSON.stringify({ name: "x" }) })),
    ).toBeNull();
  });

  test("reads the bertrand key from package.json", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ bertrand: { run: "next dev", setup: "pnpm i" } }),
    });
    expect(readRepoWorkspaceConfig(dir)).toEqual({ run: "next dev", setup: "pnpm i" });
  });

  test("reads .bertrand/config.json", () => {
    const dir = fixture({
      ".bertrand/config.json": JSON.stringify({ run: "vite", archive: "rm -rf .cache" }),
    });
    expect(readRepoWorkspaceConfig(dir)).toEqual({ run: "vite", archive: "rm -rf .cache" });
  });

  test("the dedicated file wins key-by-key over the package.json key", () => {
    const dir = fixture({
      "package.json": JSON.stringify({ bertrand: { run: "from-pkg", setup: "from-pkg-setup" } }),
      ".bertrand/config.json": JSON.stringify({ run: "from-file" }),
    });
    // run overridden by the file; setup kept from package.json.
    expect(readRepoWorkspaceConfig(dir)).toEqual({ run: "from-file", setup: "from-pkg-setup" });
  });

  test("ignores unknown keys and non-string values", () => {
    const dir = fixture({
      "package.json": JSON.stringify({
        bertrand: { run: "vite", port: 3000, junk: true, devCommand: "x" },
      }),
    });
    expect(readRepoWorkspaceConfig(dir)).toEqual({ run: "vite", devCommand: "x" });
  });

  test("malformed config file degrades to absent", () => {
    const dir = fixture({ ".bertrand/config.json": "{ broken" });
    expect(readRepoWorkspaceConfig(dir)).toBeNull();
  });

  test("reads the api sidecar command", () => {
    const dir = fixture({
      "package.json": JSON.stringify({
        bertrand: { run: "vite", api: "bun run src/index.ts serve" },
      }),
    });
    expect(readRepoWorkspaceConfig(dir)).toEqual({
      run: "vite",
      api: "bun run src/index.ts serve",
    });
  });
});
