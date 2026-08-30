import { nanoid } from "nanoid";

export function createId(size = 12): string {
  return nanoid(size);
}

/**
 * Slug for a session created without a name. Lowercased so it reads like a
 * hand-typed slug; the "new-" prefix marks it machine-issued until pause-time
 * derivation (name_source='derived') replaces it.
 */
export function placeholderSlug(): string {
  return `new-${nanoid(6).toLowerCase()}`;
}
