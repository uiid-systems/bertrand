import { register } from "@/cli/router";
import {
  resolveSessionByName,
  renameSession,
  getSessionByCategorySlug,
} from "@/db/queries/sessions";
import {
  recordSessionAlias,
  getSessionByAlias,
} from "@/db/queries/session-aliases";
import { isValidNameSegment } from "@/lib/parse-session-name";

export type RenameOutcome =
  | { ok: true; noop: boolean; oldName: string; newName: string }
  | {
      ok: false;
      reason: "not-found" | "invalid-slug" | "collision";
      message: string;
    };

/**
 * The manual rename path (ELKY-170). Collisions are REJECTED, never suffixed
 * (decided in ELKY-167): a manual name is the user's word, and silently
 * handing them "-2" would defeat the point of choosing it. The old canonical
 * name is recorded as an alias before the slug changes, so every
 * previously-typed name keeps resolving.
 */
export function runRename(sessionName: string, newSlug: string): RenameOutcome {
  // resolveSessionByName throws on malformed input (single segment, bad
  // characters) — surface that as a not-found with the parser's own message.
  let resolved;
  try {
    resolved = resolveSessionByName(sessionName);
  } catch (err) {
    return { ok: false, reason: "not-found", message: (err as Error).message };
  }
  if (!resolved) {
    return {
      ok: false,
      reason: "not-found",
      message: `Session not found: ${sessionName}. <session> is "<category>/<slug>" — see \`bertrand list\`.`,
    };
  }
  const { session, categoryPath } = resolved;

  // Same per-segment rule as parsed names; slashes join segments. The new
  // slug is a slug only — the session stays in its current category.
  const segments = newSlug.split("/");
  if (!segments.every(isValidNameSegment)) {
    return {
      ok: false,
      reason: "invalid-slug",
      message: `Invalid slug "${newSlug}": each segment must start with alphanumeric and contain only letters, digits, dots, underscores, or dashes.`,
    };
  }

  const oldName = `${categoryPath}/${session.slug}`;
  const newName = `${categoryPath}/${newSlug}`;

  if (newSlug === session.slug) {
    return { ok: true, noop: true, oldName, newName };
  }

  // Manual renames reject collisions (ELKY-167) — a live session already
  // holding the slug in this category, or an alias claiming the canonical
  // name for a different session.
  const holder = getSessionByCategorySlug(session.categoryId, newSlug);
  if (holder && holder.id !== session.id) {
    return {
      ok: false,
      reason: "collision",
      message: `Cannot rename: session ${categoryPath}/${holder.slug} already holds that name.`,
    };
  }
  const aliased = getSessionByAlias(newName);
  if (aliased && aliased.session.id !== session.id) {
    return {
      ok: false,
      reason: "collision",
      message: `"${newName}" already resolves to session ${aliased.categoryPath}/${aliased.slug} (via an alias).`,
    };
  }

  // Alias first, then rename: if the process dies between the two, a stale
  // alias is harmless, but a rename without its alias breaks old names.
  recordSessionAlias(oldName, session.id);
  renameSession(session.id, newSlug);

  return { ok: true, noop: false, oldName, newName };
}

register("rename", async (args) => {
  const [sessionName, newSlug] = args.filter((a) => !a.startsWith("--"));

  if (!sessionName || !newSlug) {
    console.error("Usage: bertrand rename <session> <new-slug>");
    console.error('       <session> is "<category>/<slug>" (see `list`)');
    process.exit(1);
  }

  const result = runRename(sessionName, newSlug);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  if (result.noop) {
    console.log(`${result.oldName} is already named that — nothing to do.`);
    return;
  }

  console.log(`renamed ${result.oldName} → ${result.newName}`);
  console.log(`(${result.oldName} still resolves to this session)`);
});
