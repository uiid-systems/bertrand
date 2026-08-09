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

const SUPPORTED_PROTOCOLS = new Set(["git:", "git+ssh:", "http:", "https:", "ssh:"]);

/** A hostname, or a bare intranet label — GHES is often reachable as one. */
const HOSTNAME = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/;

/** `:` plus a port, the only suffix a host identity may carry. */
const PORT = /^:\d+$/;

/** Knobs a caller supplies; the parser itself stays pure. */
export interface ParseOptions {
  /**
   * Hosts trusted to be GitHub Enterprise Server, beyond github.com itself.
   * Entries are normalized here, so a caller may pass config straight through.
   */
  enterpriseHosts?: readonly string[];
}

/**
 * Reduce a declared enterprise host to the form {@link parseGitHubRemote}
 * compares against, or null when the entry can never name a GHES install.
 *
 * A GHES install can live at any hostname, so nothing in a URL distinguishes
 * `git.acme.com` running GHES from the same host running GitLab. Inferring it
 * from the hostname is what this module used to do, and inference accepted
 * `github.com.evil.com` — a host that reads as github.com in anything bertrand
 * prints, and that the `gh` runner would happily dial. So enterprise hosts are
 * not guessed; they are declared per machine, and anything undeclared is not a
 * GitHub remote as far as this parser is concerned.
 *
 * Tolerant about how an entry is written — `https://GitHub.Acme.com/` and
 * `github.acme.com` are the same host — and strict about what it means: a port
 * is part of the identity, so `github.acme.com` does not trust
 * `github.acme.com:8443`.
 *
 * Nothing under or over github.com survives. Its own hostnames are covered by
 * the built-in rules above, and `github.com.<anything>` is a shape that exists
 * to be misread, so no configuration may declare it.
 */
export function normalizeEnterpriseHost(raw: string): string | null {
  const authority = raw
    .trim()
    .toLowerCase()
    // Tolerate an entry pasted from a browser or a clone command.
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^@/]*@/, "")
    .replace(/[/?#].*$/, "");

  const colon = authority.indexOf(":");
  const hostname = (colon === -1 ? authority : authority.slice(0, colon)).replace(/\.$/, "");
  const port = colon === -1 ? "" : authority.slice(colon);

  if (!HOSTNAME.test(hostname)) {
    return null;
  }
  if (port && !PORT.test(port)) {
    return null;
  }
  if (
    hostname === GITHUB_COM ||
    hostname.endsWith(`.${GITHUB_COM}`) ||
    hostname.startsWith(`${GITHUB_COM}.`)
  ) {
    return null;
  }

  return `${hostname}${port}`;
}

/**
 * Build the comparison set. Every entry goes through
 * {@link normalizeEnterpriseHost}, so the github.com rules hold no matter what
 * a caller passes in — there is no path to a trusted `github.com.evil.com`.
 */
function trustedHosts(enterpriseHosts: readonly string[] = []): ReadonlySet<string> {
  const trusted = new Set<string>();

  for (const entry of enterpriseHosts) {
    const host = normalizeEnterpriseHost(entry);
    if (host) {
      trusted.add(host);
    }
  }

  return trusted;
}

/**
 * Whether an identity's host is one this machine currently trusts.
 *
 * Exists for bindings stored before hosts had to be declared, which can carry a
 * host no allowlist would accept today. Reading one is not an error — dropping
 * a project's repo out from under it is worse than showing it — so the registry
 * keeps returning it, surfaces are expected to mark it, and any caller about to
 * *derive an endpoint* from the host asks this first.
 */
export function isTrustedHost(
  host: string | undefined,
  enterpriseHosts: readonly string[] = [],
): boolean {
  // Absent host means github.com, which is trusted by definition.
  if (host === undefined) {
    return true;
  }

  const normalized = normalizeEnterpriseHost(host);

  return normalized !== null && trustedHosts(enterpriseHosts).has(normalized);
}

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
 * host is not one we trust to be GitHub.
 */
function normalizeHost(rawHost: string, trusted: ReadonlySet<string>): string | null {
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

  // `github.com.evil.com` is not under github.com — it is a domain that reads
  // like one. No allowlist can declare it, so the set below would reject it
  // anyway; refusing it outright keeps that guarantee readable from here.
  if (hostname.startsWith(`${GITHUB_COM}.`)) {
    return null;
  }

  const candidate = colon === -1 ? hostname : `${hostname}${host.slice(colon)}`;

  return trusted.has(candidate) ? candidate : null;
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
 * Pure: no I/O, no git, no network — the enterprise allowlist is passed in
 * rather than read, so the rules stay testable and the config lives at the
 * edge. Null means "not a GitHub remote we trust" and callers should treat the
 * repo as unbindable rather than guess an identity.
 *
 * Without `enterpriseHosts` only github.com parses, which is the right default:
 * a GHES user declares their host once, and everyone else cannot be talked into
 * binding a lookalike.
 */
export function parseGitHubRemote(
  remoteUrl: string,
  opts: ParseOptions = {},
): ProviderIdentity | null {
  const remote = splitRemote(remoteUrl);

  if (!remote) {
    return null;
  }

  const host = normalizeHost(remote.host, trustedHosts(opts.enterpriseHosts));

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
