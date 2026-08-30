export interface ParsedSessionName {
  slug: string;
}

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Whether a single name segment is well-formed: starts alphanumeric, then
 * letters, digits, dots, underscores, or dashes. Shared with `bertrand rename`
 * so a new slug obeys the same per-segment rule as parsed names.
 */
export function isValidNameSegment(segment: string): boolean {
  return SEGMENT_PATTERN.test(segment);
}

/**
 * Parse a session name. Sessions are flat (ELKY-171): the whole trimmed string
 * is the slug. Slugs may legitimately contain slashes — a name is one or more
 * valid segments joined by `/` — so each segment is validated individually
 * while the joined form is returned as one identity.
 */
export function parseSessionName(input: string): ParsedSessionName {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");
  const segments = trimmed.split("/").filter(Boolean);

  if (segments.length === 0) {
    throw new Error("Session name cannot be empty");
  }

  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new Error(
        `Invalid segment "${segment}": must start with alphanumeric and contain only letters, digits, dots, underscores, or dashes`
      );
    }
  }

  return { slug: segments.join("/") };
}
