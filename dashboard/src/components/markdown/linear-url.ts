/**
 * Entity-aware parser for Linear URLs — the purple sibling of the GitHub
 * parser. Pure and network-free: it turns a `linear.app` URL into a
 * structured ref based purely on the URL shape. Only recognizes concrete
 * entities (issue, project); everything else (marketing pages, docs, bare
 * workspace) returns null so callers fall back to a plain link.
 */

export type LinearRef =
  | { kind: "issue"; workspace: string; identifier: string }
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
  const [workspace, section, id] = parts;
  if (!workspace || !section || !id) return null;

  // /<workspace>/issue/<TEAM-123>[/<slug>]
  if (section === "issue") {
    return { kind: "issue", workspace, identifier: id };
  }
  // /<workspace>/project/<kebab-name>-<id>
  if (section === "project") {
    return { kind: "project", workspace, name: humanizeProjectSlug(id) };
  }

  return null;
}

// Linear project slugs are `<kebab-name>-<hex id>`. Drop the trailing id and
// restore spaces for a readable label.
function humanizeProjectSlug(slug: string): string {
  const withoutId = slug.replace(/-[0-9a-f]{8,}$/i, "");
  const words = (withoutId || slug).replace(/-/g, " ").trim();
  return words || slug;
}

/** Compact chip label: issue identifier (`UI-177`) or humanized project name. */
export function linearRefLabel(ref: LinearRef): string {
  switch (ref.kind) {
    case "issue":
      return ref.identifier.toUpperCase();
    case "project":
      return ref.name;
  }
}
