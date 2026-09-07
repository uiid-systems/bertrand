import { customAlphabet, nanoid } from "nanoid";

export function createId(size = 12): string {
  return nanoid(size);
}

/** Longest a branch-seeded slug may run before it stops reading as a name. */
const MAX_SLUG_CHARS = 48;

/**
 * Branch names that identify no particular piece of work.
 *
 * A session on the repo's default branch is one of many: the default branch is
 * a workbench hosting months of unrelated work, which is the same reason
 * `mainCheckout` can't serve as a group identity. Seeding from it would file
 * unrelated sessions as `main`, `main-2`, `main-3` — a worse lie than an
 * obviously-machine-issued name, so these fall back to the random placeholder.
 */
const GENERIC_BRANCHES = new Set([
  "main",
  "master",
  "trunk",
  "dev",
  "develop",
  "development",
]);

/**
 * A branch name reduced to a slug segment, or null when it carries no usable
 * name.
 *
 * Only the last path component survives. Branches are conventionally prefixed
 * with an owner or a type (`adamfratino/ui-196-…`, `feature/foo`), and that
 * prefix says who or what kind — never which work — so it is noise in a list
 * already grouped by repo. Dropping it also removes the `/` that would
 * otherwise split the slug into two segments, which sessions no longer have.
 *
 * Over-long branches are cut at a token boundary rather than mid-word, so a
 * truncated name still reads as words instead of stopping in the middle of one.
 */
export function slugFromBranch(
  branch: string | null | undefined,
): string | null {
  if (!branch) return null;

  const tail = branch.split("/").filter(Boolean).pop() ?? "";
  let slug = tail
    .toLowerCase()
    // Anything outside a slug segment's alphabet becomes a separator, and runs
    // of separators collapse, so `feat//fix__(thing)` doesn't leave gaps.
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    // A segment must start alphanumeric; trailing punctuation is just untidy.
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  if (slug.length > MAX_SLUG_CHARS) {
    const cut = slug.slice(0, MAX_SLUG_CHARS);
    const boundary = cut.lastIndexOf("-");
    slug = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(
      /[^a-z0-9]+$/,
      "",
    );
  }

  if (!slug) return null;
  if (GENERIC_BRANCHES.has(slug)) return null;
  return slug;
}

/**
 * The random half of a placeholder slug. A lowercase alphanumeric alphabet
 * rather than nanoid's default, which includes `-` and `_` and so produced
 * names that ended in a stray dash (`new-etxcb-`).
 */
const placeholderId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

/**
 * Slug for a session created without a name and without a usable branch to
 * seed from. The "new-" prefix marks it machine-issued until pause-time
 * derivation (name_source='derived') replaces it.
 *
 * Prefer {@link slugFromBranch} where a branch is known: a session that never
 * reaches derivation keeps whatever name it was created with, and `new-0dqjum`
 * is the name a quarter of them were still wearing.
 */
export function placeholderSlug(): string {
  return `new-${placeholderId()}`;
}
