export interface ParsedSessionName {
  groupPath: string;
  slug: string;
}

/**
 * Parse a slash-delimited session name into group path and session slug.
 * The last segment is the session slug; everything before it is the group path.
 * Requires at least one group level (minimum: "group/session").
 */
export function parseSessionName(input: string): ParsedSessionName {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, "");

  if (!trimmed) {
    throw new Error("Session name cannot be empty");
  }

  const segments = trimmed.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new Error(
      `Session name must include at least one group: "group/session" (got "${trimmed}")`
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
  const groupPath = segments.slice(0, -1).join("/");

  return { groupPath, slug };
}
