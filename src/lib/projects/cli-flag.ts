import { _resetActiveProjectCache } from "./resolve";
import { projectExists } from "./registry";

/**
 * Parse `--project <slug>` (or `--project=<slug>`) out of an argv array.
 * Returns the slug and the argv with the flag removed so downstream parsing
 * doesn't see it as a positional.
 */
export function extractProjectFlag(args: string[]): {
  project?: string;
  rest: string[];
} {
  const rest: string[] = [];
  let project: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") {
      project = args[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--project=")) {
      project = a.slice("--project=".length);
      continue;
    }
    rest.push(a);
  }
  return { project, rest };
}

/**
 * Swap the active project for the rest of this process. Sets
 * BERTRAND_PROJECT (which `resolveActiveProject` checks first) and busts
 * the memoization cache so subsequent `getDb()` calls open the right
 * project's SQLite file.
 *
 * Exits non-zero on an unknown slug — agents mistyping should fail loudly
 * instead of silently falling back to the active project's data.
 */
export function applyProjectFlag(slug: string | undefined): void {
  if (!slug) return;
  if (!projectExists(slug)) {
    console.error(
      `Unknown project: ${slug}. Run \`bertrand project list\` to see registered projects.`,
    );
    process.exit(1);
  }
  useProject(slug);
}

/**
 * Switch project without the registry check.
 *
 * For slugs bertrand produced itself rather than read off a command line — an
 * adoption marker's `project=`, say. Those name a project that was active when
 * it was written, which on a fresh install is `default`: real, in use, and not
 * in the registry, because nothing has called `project create`. Routing them
 * through {@link applyProjectFlag} would exit(1) on a perfectly good session.
 * A typo can't reach here; only a mistyped flag needs to fail loudly.
 */
export function useProject(slug: string): void {
  process.env.BERTRAND_PROJECT = slug;
  _resetActiveProjectCache();
}
