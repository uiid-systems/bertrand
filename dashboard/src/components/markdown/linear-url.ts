/**
 * Entity-aware parser for Linear URLs — the purple sibling of the GitHub
 * parser. Pure and network-free: it turns a `linear.app` URL into a
 * structured ref based purely on the URL shape. Only recognizes concrete
 * entities (issue, project); everything else (marketing pages, docs, bare
 * workspace) returns null so callers fall back to a plain link.
 */

export type LinearRef =
  | { kind: "issue"; workspace: string; identifier: string; title?: string }
  | { kind: "project"; workspace: string; name: string };

export function parseLinearUrl(href: string): LinearRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (host !== "linear.app" && host !== "www.linear.app") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const [workspace, section, id, slug] = parts;
  if (!workspace || !section || !id) return null;

  // /<workspace>/issue/<TEAM-123>[/<slug>]
  if (section === "issue") {
    return {
      kind: "issue",
      workspace,
      identifier: id.toUpperCase(),
      title: slug ? humanizeSlug(slug) : undefined,
    };
  }
  // /<workspace>/project/<kebab-name>-<id>
  if (section === "project") {
    return { kind: "project", workspace, name: humanizeSlug(stripTrailingId(id)) };
  }

  return null;
}

// Linear project slugs are `<kebab-name>-<hex id>`. Drop the trailing id.
function stripTrailingId(slug: string): string {
  return slug.replace(/-[0-9a-f]{8,}$/i, "") || slug;
}

// Kebab slug -> readable title, first letter capitalized.
function humanizeSlug(slug: string): string {
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

/**
 * Compact chip label, written so the leading token signals the entity type:
 * issues lead with the identifier (`UI-177`, obviously a ticket) and append
 * the title from the slug; projects lead with a `Project ·` prefix so they
 * are never mistaken for a ticket.
 */
export function linearRefLabel(ref: LinearRef): string {
  switch (ref.kind) {
    case "issue":
      return ref.title ? `${ref.identifier} · ${ref.title}` : ref.identifier;
    case "project":
      return `Project · ${ref.name}`;
  }
}
