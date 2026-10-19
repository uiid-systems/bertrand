/**
 * Static import-graph primitives for `layer-boundary.test.ts` (nothing in
 * Layer 1 may reach the launcher): reading specifiers out of a file and turning
 * one into a path on disk.
 *
 * Test-only. Nothing in the shipped CLI imports this module.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

/**
 * Every `from "..."` specifier in a module, type-only imports included.
 *
 * Deliberately blind to `await import("…")`. That is the whole point in
 * `layer-boundary.test.ts`: a dynamic import is how an optional dependency is
 * spelled, and it must not read as an edge.
 *
 * The gap between the keyword and `from` is `[^;]*?` rather than `[\s\S]*?`:
 * an import statement never contains a `;` before its `from`, so this still
 * spans a multi-line clause but can't run from an unrelated `export` through
 * paragraphs of prose to a `from "…"` inside a comment. (It did: a JSDoc line
 * in `workspace/server.ts` reading `… from "up" (listening)` parsed as an
 * import of `up`. Harmless there, but a comment saying `from "fs"` would have
 * failed that test for no reason.)
 */
export function specifiersOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) found.push(match[1]!);
  return found;
}

/**
 * Resolve a relative or `@/`-aliased specifier to a file on disk, `null` for a
 * bare package specifier (not ours to walk) or an unresolvable path.
 *
 * `srcRoot` is what `@/` maps to — the root `src`, per `tsconfig.json`.
 */
export function resolveSpec(
  spec: string,
  fromFile: string,
  srcRoot: string,
): string | null {
  const base = spec.startsWith("@/")
    ? join(srcRoot, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(fromFile), spec)
      : null;
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (!candidate.endsWith(".ts") && !candidate.endsWith(".tsx")) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every `.ts`/`.tsx` file under `dir`, recursively. */
export function tsFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) found.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(item.name)) found.push(full);
  }
  return found;
}

/** True for `foo.test.ts` / `foo.test.tsx`. */
export const isTestFile = (file: string) => /\.test\.tsx?$/.test(file);
