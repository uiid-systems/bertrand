/**
 * Entity-aware parser for GitHub URLs. Pure and network-free: it turns a
 * `github.com` URL into a structured ref based purely on the URL *shape*
 * (the "URL parser" POC — no API calls, no titles fetched). Returns null for
 * anything that isn't a recognizable GitHub entity so callers can fall back
 * to a plain link.
 *
 * The Linear equivalent will follow the same parse → label → chip seam.
 */

export type GithubRef =
  | { kind: "pr"; owner: string; repo: string; number: string }
  | { kind: "issue"; owner: string; repo: string; number: string }
  | { kind: "commit"; owner: string; repo: string; sha: string }
  | { kind: "repo"; owner: string; repo: string }
  | { kind: "user"; login: string };

// Top-level github.com paths that are site chrome, not user/org accounts.
// Keeps `github.com/features` from parsing as a user chip.
const RESERVED_OWNERS = new Set([
  "about",
  "apps",
  "enterprise",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "logout",
  "marketplace",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "settings",
  "sponsors",
  "topics",
]);

export function parseGithubUrl(href: string): GithubRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo, type, id] = parts;
  if (!owner) return null;

  // /owner
  if (parts.length === 1) {
    if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    return { kind: "user", login: owner };
  }

  // /owner/repo
  if (parts.length === 2) {
    return { kind: "repo", owner, repo: repo! };
  }

  // /owner/repo/pull/123
  if (type === "pull" && id) {
    return { kind: "pr", owner, repo: repo!, number: id };
  }
  // /owner/repo/issues/123
  if (type === "issues" && id) {
    return { kind: "issue", owner, repo: repo!, number: id };
  }
  // /owner/repo/commit/<sha>
  if (type === "commit" && id) {
    return { kind: "commit", owner, repo: repo!, sha: id };
  }

  // Deeper links (blob, tree, actions, releases, …): degrade to the repo.
  return { kind: "repo", owner, repo: repo! };
}

/** Compact chip label, e.g. `owner/repo#123`, `owner/repo@abc1234`, `@owner`. */
export function githubRefLabel(ref: GithubRef): string {
  switch (ref.kind) {
    case "pr":
    case "issue":
      return `${ref.owner}/${ref.repo}#${ref.number}`;
    case "commit":
      return `${ref.owner}/${ref.repo}@${ref.sha.slice(0, 7)}`;
    case "repo":
      return `${ref.owner}/${ref.repo}`;
    case "user":
      return `@${ref.login}`;
  }
}
