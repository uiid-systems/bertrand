export interface ParsedSessionName {
  categoryPath: string;
  slug: string;
}

const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Parse a slash-delimited session name. The first segment is the category;
 * every remaining segment is joined with `/` to form the slug. Each segment
 * is validated individually; slashes inside the slug are preserved.
 */
export function parseSessionName(input: string): ParsedSessionName {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");

  if (!trimmed) {
    throw new Error("Session name cannot be empty");
  }

  const segments = trimmed.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(
      `Session name must include at least one category: "category/session" (got "${trimmed}")`
    );
  }

  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      throw new Error(
        `Invalid segment "${segment}": must start with alphanumeric and contain only letters, digits, dots, underscores, or dashes`
      );
    }
  }

  const categoryPath = segments[0]!;
  const slug = segments.slice(1).join("/");

  return { categoryPath, slug };
}
