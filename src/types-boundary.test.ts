import { describe, expect, test } from "bun:test";
import { join, resolve } from "path";
import { resolveSpec, specifiersOf, tsFilesUnder } from "./import-graph";

/**
 * The dashboard's TypeScript program is `include: ["src", "../src/types.ts"]`
 * with `@/*` mapped to `../src/*` (`dashboard/tsconfig.json`). That is *two*
 * doors into the root `src`, and every module reachable through either has to
 * resolve under the dashboard's build:
 *
 *   1. `src/types.ts`, the shared barrel; and
 *   2. any file under `dashboard/src` that imports `@/…` directly.
 *
 * `import type` does not make either safe: it erases the runtime import, but
 * the type graph still resolves, so a type imported from a module that does
 * I/O makes the dashboard build depend on that module's entire subtree. It
 * typechecks right up until someone adds a value-level import the dashboard
 * can't resolve — and then the error points at the barrel, not at the cause.
 *
 * This test walks both doors and fails on any module that reaches a
 * runtime-only dependency. The fix is never to loosen `FORBIDDEN`: it's to
 * move the shape into a leaf type module beside the module that owns it, and
 * re-export it from there.
 */

const SRC = resolve(import.meta.dir);
const DASHBOARD_SRC = resolve(SRC, "../dashboard/src");

/** Specifiers no module in the dashboard's type graph may reach. */
const FORBIDDEN = new Set([
  "bun",
  "child_process",
  "crypto",
  "fs",
  "fs/promises",
  "http",
  "https",
  "net",
  "os",
  "path",
]);

const normalize = (spec: string) =>
  spec.startsWith("node:") ? spec.slice("node:".length) : spec;

const rel = (file: string) => file.replace(`${resolve(SRC, "..")}/`, "");

/** Import chains from `entry` that end at a forbidden specifier. */
function forbiddenReachableFrom(entry: string): string[] {
  const violations: string[] = [];
  const visited = new Set<string>();

  const walk = (file: string, trail: string[]) => {
    if (visited.has(file)) return;
    visited.add(file);
    const chain = [...trail, file];
    for (const spec of specifiersOf(file)) {
      if (FORBIDDEN.has(normalize(spec))) {
        violations.push(`${chain.map(rel).join(" → ")} imports "${spec}"`);
        continue;
      }
      const next = resolveSpec(spec, file, SRC);
      if (next !== null) walk(next, chain);
    }
  };

  walk(entry, []);
  return violations;
}

/**
 * Dashboard modules that reach into the root `src` via `@/`. Discovered rather
 * than listed so a new `@/` import is covered the day it's written.
 */
function dashboardEntryPoints(): string[] {
  return tsFilesUnder(DASHBOARD_SRC).filter((file) =>
    specifiersOf(file).some((s) => s.startsWith("@/")),
  );
}

describe("dashboard type-graph boundary", () => {
  test("src/types.ts reaches no module that imports a runtime-only dependency", () => {
    const violations = forbiddenReachableFrom(join(SRC, "types.ts"));
    expect(violations).toEqual([]);
  });

  test("no dashboard @/ import reaches a runtime-only dependency", () => {
    const entries = dashboardEntryPoints();
    // A discovery bug that found nothing would otherwise pass vacuously.
    expect(entries.length).toBeGreaterThan(0);
    const violations = entries.flatMap(forbiddenReachableFrom);
    expect(violations).toEqual([]);
  });

  // Guards the guard: a walker that silently stopped resolving would report
  // a clean graph forever. `server/index.ts` is known to reach `fs` and friends.
  test("detects violations when they exist", () => {
    const violations = forbiddenReachableFrom(join(SRC, "server/index.ts"));
    expect(violations.length).toBeGreaterThan(0);
  });
});
