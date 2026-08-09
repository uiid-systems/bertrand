/**
 * Portable identity of a GitHub repository. Portable is the point: bertrand
 * syncs projects across machines, where `owner/repo` travels and a checkout
 * path does not.
 */
export interface ProviderIdentity {
  /** Discriminant; other forges would be additive. */
  provider: "github";
  owner: string;
  repo: string;
  /** Undefined means github.com. Set only for GitHub Enterprise Server. */
  host?: string;
}

const GITHUB_COM = "github.com";

/** Hostnames that address github.com itself. */
const GITHUB_COM_HOSTS = new Set([
  GITHUB_COM,
  "www.github.com",
  // GitHub documents ssh.github.com as SSH-over-HTTPS for github.com repos.
  "ssh.github.com",
]);

/**
 * Hostname labels that mark a self-hosted GitHub Enterprise Server.
 *
 * A GHES install can live at any hostname, so nothing in a URL distinguishes
 * `git.acme.com` running GHES from the same host running GitLab. We recognize
 * the conventional labels and return null for everything else: refusing to
 * bind a host we cannot identify is recoverable, minting a GitHub identity for
 * a GitLab remote is not.
 */
const ENTERPRISE_LABELS = new Set(["github", "ghe"]);

const SUPPORTED_PROTOCOLS = new Set(["git:", "git+ssh:", "http:", "https:", "ssh:"]);

/** `[user@]host:path` — the SCP-style remote, which is not a parseable URL. */
const SCP_REMOTE = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/;

interface RemoteParts {
  host: string;
  path: string;
}

function splitRemote(remoteUrl: string): RemoteParts | null {
  const trimmed = remoteUrl.trim();

  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes("://")) {
    const match = SCP_REMOTE.exec(trimmed);
    return match ? { host: match[1]!, path: match[2]! } : null;
  }

  try {
    const url = new URL(trimmed);

    if (!SUPPORTED_PROTOCOLS.has(url.protocol.toLowerCase())) {
      return null;
    }

    // An HTTP port addresses the GHES web/API endpoint and is part of the host
    // identity; ssh and git ports are transport-only and must not leak into it.
    const isHttp = url.protocol === "http:" || url.protocol === "https:";

    return { host: isHttp ? url.host : url.hostname, path: url.pathname };
  } catch {
    return null;
  }
}

/**
 * Reduce a remote's host to the host GitHub is served from, or null when the
 * host is not recognizably GitHub.
 */
function normalizeHost(rawHost: string): string | null {
  const host = rawHost.trim().toLowerCase();
  const colon = host.indexOf(":");
  const hostname = (colon === -1 ? host : host.slice(0, colon)).replace(/\.$/, "");

  if (!hostname) {
    return null;
  }

  // Under github.com only the repo-serving hostnames count; gist.github.com and
  // api.github.com are github.com but never a repo remote.
  if (hostname === GITHUB_COM || hostname.endsWith(`.${GITHUB_COM}`)) {
    return GITHUB_COM_HOSTS.has(hostname) ? GITHUB_COM : null;
  }

  if (!hostname.split(".").some((label) => ENTERPRISE_LABELS.has(label))) {
    return null;
  }

  return colon === -1 ? hostname : `${hostname}${host.slice(colon)}`;
}

function parseOwnerRepo(path: string): Pick<ProviderIdentity, "owner" | "repo"> | null {
  const segments = path.replace(/^\/+/, "").replace(/\/+$/, "").split("/");

  // Exactly owner/repo. Anything deeper is a web URL, not a clonable remote.
  if (segments.length !== 2) {
    return null;
  }

  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/i, "");

  return owner && repo ? { owner, repo } : null;
}

/**
 * Parse a git remote URL into a portable GitHub identity.
 *
 * Pure: no I/O, no git, no network. Null means "not a GitHub remote" and
 * callers should treat the repo as unbindable rather than guess an identity.
 */
export function parseGitHubRemote(remoteUrl: string): ProviderIdentity | null {
  const remote = splitRemote(remoteUrl);

  if (!remote) {
    return null;
  }

  const host = normalizeHost(remote.host);

  if (!host) {
    return null;
  }

  const ownerRepo = parseOwnerRepo(remote.path);

  if (!ownerRepo) {
    return null;
  }

  return host === GITHUB_COM
    ? { provider: "github", ...ownerRepo }
    : { provider: "github", ...ownerRepo, host };
}

/** Display form: `owner/repo`, prefixed with the host on enterprise. */
export function formatIdentity(identity: ProviderIdentity): string {
  const ownerRepo = `${identity.owner}/${identity.repo}`;
  return identity.host ? `${identity.host}/${ownerRepo}` : ownerRepo;
}

/**
 * Whether two identities address the same repository.
 *
 * Lives here rather than at the call site because it depends on two invariants
 * this module owns: an absent `host` means github.com, and GitHub treats
 * `owner`/`repo` case-insensitively — so `Acme/Bertrand` and `acme/bertrand`
 * are one repo, and a caller comparing fields by hand would say otherwise.
 */
export function sameIdentity(a: ProviderIdentity, b: ProviderIdentity): boolean {
  return (
    a.provider === b.provider &&
    (a.host ?? GITHUB_COM) === (b.host ?? GITHUB_COM) &&
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase()
  );
}
