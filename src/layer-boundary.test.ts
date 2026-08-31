import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { isTestFile, resolveSpec, specifiersOf, tsFilesUnder } from "./import-graph";

/**
 * The launcher is optional (ELKY-176).
 *
 * `src/engine` (the PTY relay) and `src/tui` (the Storm launcher) are a nicer
 * way to start a session, not a requirement for recording one. Everything that
 * actually records — the hooks, the DB, the contract, the CLI commands those
 * hooks fire — has to work in a process where neither directory was ever
 * loaded, because that is the shape of a session bertrand did not launch
 * (`bertrand adopt`, ELKY-179/180).
 *
 * Neither directory is deleted, and neither is deprecated: the PTY relay is the
 * only route to a live terminal in the browser, and the TUI remains the nicer
 * path. Demoted means *reachable only on demand*.
 *
 * Two tests, because the property has two halves that can fail independently:
 *
 *   1. **Statically** — no Layer 1 module may name `src/engine` or `src/tui` in
 *      an `import … from` clause, directly or through any chain. `await
 *      import("…")` is deliberately invisible to this walk: it is how an
 *      optional dependency is spelled, and the two sites that use it
 *      (`cli/commands/launch.ts`, `server/index.ts`) are the demotion.
 *   2. **At runtime** — running the real entrypoint must load zero modules from
 *      either directory. This is the half that catches a top-level `await
 *      import`, which the static walk cannot see by construction.
 */

const SRC = resolve(import.meta.dir);
const ROOT = resolve(SRC, "..");

/** The optional launcher. Directory names under `src`. */
const LAUNCHER_DIRS = ["engine", "tui"] as const;

/**
 * Layer 1 — what bertrand is when it is only a logger: the database, the hook
 * handlers, the contract, the CLI, and the lib modules the hook-fired commands
 * reach for. Taken from the layering in docs/orca-boundary.md (Workstream 4).
 *
 * `src/server` is Layer 2 and not listed, but it is *reached* from Layer 1 via
 * `cli/commands/serve.ts`, so the walk covers it anyway — which matters,
 * because `bertrand serve` runs for the whole of every recorded session.
 */
const LAYER_1_DIRS = ["db", "hooks", "contract", "cli"];
const LAYER_1_FILES = [
  "index.ts",
  "lib/digest.ts",
  "lib/search.ts",
  "lib/transcript.ts",
  "lib/summary.ts",
  "lib/compact.ts",
];

const rel = (file: string) => file.replace(`${ROOT}/`, "");

const isLauncher = (file: string) =>
  LAUNCHER_DIRS.some((dir) => file.startsWith(`${join(SRC, dir)}/`));

/**
 * Every shipped module in Layer 1. Tests are excluded: they are free to import
 * the launcher directly, and several do.
 */
function layerOneEntryPoints(): string[] {
  return [
    ...LAYER_1_DIRS.flatMap((dir) => tsFilesUnder(join(SRC, dir))),
    ...LAYER_1_FILES.map((file) => join(SRC, file)),
  ].filter((file) => !isTestFile(file));
}

/** Static import chains from `entry` that end inside the launcher. */
function launcherReachableFrom(entry: string): string[] {
  const violations: string[] = [];
  const visited = new Set<string>();

  const walk = (file: string, trail: string[]) => {
    if (visited.has(file)) return;
    visited.add(file);
    const chain = [...trail, file];
    for (const spec of specifiersOf(file)) {
      const next = resolveSpec(spec, file, SRC);
      if (next === null) continue; // bare package — not ours to walk
      if (isLauncher(next)) {
        violations.push([...chain, next].map(rel).join(" → "));
        continue;
      }
      walk(next, chain);
    }
  };

  walk(entry, []);
  return violations;
}

describe("layer boundary — static", () => {
  // A typo'd path would quietly shrink the entry set and the suite would still
  // be green, so the list is checked against disk rather than trusted.
  test("every named Layer 1 module exists", () => {
    const missing = LAYER_1_FILES.filter((f) => !existsSync(join(SRC, f)))
      .concat(LAYER_1_DIRS.filter((d) => !existsSync(join(SRC, d))))
      .concat(LAUNCHER_DIRS.filter((d) => !existsSync(join(SRC, d))));
    expect(missing).toEqual([]);
  });

  test("no Layer 1 module statically imports the launcher", () => {
    const entries = layerOneEntryPoints();
    expect(entries.length).toBeGreaterThan(0);
    const violations = [...new Set(entries.flatMap(launcherReachableFrom))].sort();
    expect(violations).toEqual([]);
  });

  // Guards the guard: a walker that stopped resolving would report a clean
  // graph forever. The TUI's own entrypoint is known to reach the engine, and
  // is allowed to — it is the launcher.
  test("detects launcher edges when they exist", () => {
    expect(launcherReachableFrom(join(SRC, "tui/app.tsx")).length).toBeGreaterThan(0);
  });
});

/**
 * A Bun runtime plugin that reports every module loaded out of the launcher
 * directories, passing the real source through unchanged so the program under
 * test behaves normally. Written to a temp dir and handed to `bun --preload`.
 *
 * The filter is built from `LAUNCHER_DIRS` rather than hard-coded, so the
 * guard-the-guard below covers both arms of it at once.
 */
const MARKER = "[launcher-loaded]";
const probeSource = () => `
import { plugin } from "bun";

plugin({
  name: "layer-boundary-probe",
  setup(build) {
    build.onLoad(
      { filter: new RegExp(${JSON.stringify(`/src/(${LAUNCHER_DIRS.join("|")})/`)}) },
      async (args) => {
        console.error(${JSON.stringify(MARKER)} + " " + args.path);
        return {
          contents: await Bun.file(args.path).text(),
          loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
        };
      },
    );
  },
});
`;

const scratch = mkdtempSync(join(tmpdir(), "bertrand-layer-boundary-"));
const probePath = join(scratch, "probe.ts");
writeFileSync(probePath, probeSource());

async function runProbed(args: string[]) {
  const proc = Bun.spawn([process.execPath, "--preload", probePath, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const loaded = stderr
    .split("\n")
    .filter((line) => line.startsWith(MARKER))
    .map((line) => rel(line.slice(MARKER.length).trim()));
  return { loaded, stdout, stderr, exitCode };
}

describe("layer boundary — runtime", () => {
  /**
   * `--help` returns before the migration check and touches no database, but it
   * still goes through `src/index.ts`'s cold-path branch, which imports every
   * command module bertrand has. So this loads strictly more than any
   * hook-fired command does: if the launcher stays unloaded here, it stays
   * unloaded on the recording path.
   */
  test("the CLI entrypoint loads no launcher module", async () => {
    const { loaded, stdout, exitCode } = await runProbed(["src/index.ts", "--help"]);
    // Don't let a crashed run pass as "loaded nothing".
    expect(exitCode).toBe(0);
    expect(stdout).toContain("multi-session workflow manager");
    expect(loaded).toEqual([]);
  }, 30_000);

  // Guards the guard, across both launcher directories: a probe whose filter
  // stopped matching would report a clean run forever. `pty.ts` and
  // `launch.types.ts` are leaves — importing them starts nothing.
  test("the probe reports launcher modules when they are loaded", async () => {
    const entry = join(scratch, "guard.ts");
    writeFileSync(
      entry,
      LAUNCHER_DIRS.map(
        (dir, i) =>
          `import ${JSON.stringify(
            join(SRC, dir, ["pty.ts", "screens/launch/launch.types.ts"][i]!),
          )};`,
      ).join("\n"),
    );
    const { loaded, exitCode } = await runProbed([entry]);
    expect(exitCode).toBe(0);
    expect(loaded).toEqual(["src/engine/pty.ts", "src/tui/screens/launch/launch.types.ts"]);
  }, 30_000);
});
