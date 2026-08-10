import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * `src/types.ts` is the barrel the dashboard's TypeScript program includes
 * (`dashboard/tsconfig.json` → `include: ["src", "../src/types.ts"]`, with
 * `@/*` mapped to `../src/*`). Every module reachable from it therefore has to
 * resolve under the dashboard's build.
 *
 * `import type` does not make that safe: it erases the runtime import, but the
 * type graph still resolves, so a type imported from a module that does I/O
 * makes the dashboard build depend on that module's entire subtree. It
 * typechecks right up until someone adds a value-level import the dashboard
 * can't resolve — and then the error points at `types.ts`, not at the cause.
 *
 * This test walks the graph and fails on the first module that reaches a
 * runtime-only dependency. The fix is never to loosen this list: it's to move
 * the shape into a leaf `types.ts` beside the module that owns it, and
 * re-export it from there.
 */

const SRC = resolve(import.meta.dir);

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

/** Resolve a relative or `@/`-aliased specifier to a file on disk. */
function resolveSpec(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (base === null) return null; // bare package — not ours to walk
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (candidate.endsWith(".ts") || candidate.endsWith(".tsx")) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Every `from "..."` specifier in a module, type-only imports included. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) found.push(match[1]!);
  return found;
}

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
        const path = chain.map((f) => f.replace(`${SRC}/`, "")).join(" → ");
        violations.push(`${path} imports "${spec}"`);
        continue;
      }
      const next = resolveSpec(spec, file);
      if (next !== null) walk(next, chain);
    }
  };

  walk(entry, []);
  return violations;
}

describe("src/types.ts dashboard boundary", () => {
  test("reaches no module that imports a runtime-only dependency", () => {
    const violations = forbiddenReachableFrom(join(SRC, "types.ts"));
    expect(violations).toEqual([]);
  });

  // Guards the guard: a walker that silently stopped resolving would report
  // a clean graph forever. `server/index.ts` is known to reach `fs` and friends.
  test("detects violations when they exist", () => {
    const violations = forbiddenReachableFrom(join(SRC, "server/index.ts"));
    expect(violations.length).toBeGreaterThan(0);
  });
});
