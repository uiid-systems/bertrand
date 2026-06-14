export interface ParsedSessionName {
  categoryPath: string;
  slug: string;
}

/**
 * Parse a slash-delimited session name into category path and session slug.
 * The last segment is the session slug; everything before it is the category path.
 * Requires at least one category level (minimum: "category/session").
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
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(segment)) {
      throw new Error(
        `Invalid segment "${segment}": must start with alphanumeric and contain only letters, digits, dots, underscores, or dashes`
      );
    }
  }

  const slug = segments[segments.length - 1]!;
  const categoryPath = segments.slice(0, -1).join("/");

  return { categoryPath, slug };
}
