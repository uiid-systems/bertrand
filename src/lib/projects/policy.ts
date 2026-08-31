import { resolve as resolvePath } from "path";
import {
  formatIdentity,
  sameIdentity,
  type ProviderIdentity,
} from "@/lib/github/identity";
import { resolveRepoAt, type RepoFailureReason } from "@/lib/github/resolve";
import { getProjectRepo, listProjects, type ProjectEntry, type ProjectRepo } from "./registry";

/**
 * Thrown by {@link requireBoundRepo} when a project has no repo attached.
 *
 * This is the *only* place the "a project must be attached to GitHub" rule is
 * enforced. It is deliberately absent from the registry schema and from
 * `writeRegistry`, so relaxing the rule later — session logging outside a git
 * repo, say — is an edit to this file rather than a migration of every
 * `projects.json` in the wild.
 */
export class UnboundProjectError extends Error {
  constructor(readonly slug: string) {
    super(
      `Project "${slug}" is not attached to a GitHub repository.\n` +
        `  Attach one with: bertrand project link ${slug} <path-to-repo>`,
    );
    this.name = "UnboundProjectError";
  }
}

/** Why a requested binding was refused. */
export type BindFailureReason = RepoFailureReason | "already-bound";

/**
 * Thrown when a path cannot become a binding — either it does not resolve to a
 * GitHub repo, or another project already owns that repo. Carries `reason` so
 * callers can branch; `message` is already written for a human.
 */
export class RepoBindError extends Error {
  constructor(
    readonly reason: BindFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "RepoBindError";
  }
}

/**
 * The gate. Returns the project's binding or throws {@link UnboundProjectError}.
 *
 * Callers that need a repo should go through this rather than reading
 * `getProjectRepo` and null-checking, so the policy stays in one place and the
 * error message stays consistent.
 */
export function requireBoundRepo(slug: string): ProjectRepo {
  const repo = getProjectRepo(slug);
  if (!repo) {
    throw new UnboundProjectError(slug);
  }
  return repo;
}

/** The project bound to `identity`, if any. */
export function findProjectByRepo(identity: ProviderIdentity): ProjectEntry | undefined {
  return listProjects().find((p) => p.repo && sameIdentity(p.repo.provider, identity));
}

/**
 * The project a directory belongs to, resolved by git origin.
 *
 * Deliberately *not* a path-prefix match against each project's `repo.path`.
 * 13 of the 22 cwds on the machine this was measured against are Orca
 * workspaces — linked worktrees living under no registered checkout — and
 * prefix matching misses every one of them. Origin matching gets all 101
 * transcripts, because `resolveRepoAt` normalizes a linked worktree to its
 * main checkout before reading the remote (`docs/session-identity.md`, Q4).
 *
 * Null for a directory that is not a git repo, has no GitHub `origin`, or
 * whose origin no project is bound to. Callers must treat that as "not our
 * business" — never as license to invent a project, which is a policy
 * decision reserved to the human (see {@link UnboundProjectError}).
 */
export async function resolveProjectForCwd(
  cwd: string,
): Promise<ProjectEntry | null> {
  const resolution = await resolveRepoAt(resolvePath(cwd));
  if (!resolution.ok) return null;
  return findProjectByRepo(resolution.repo.provider) ?? null;
}

/**
 * Strip `user:token@` from a remote before it is echoed back.
 *
 * A remote can carry an embedded credential, and this message goes to stdout —
 * terminal scrollback, CI logs, screenshots, pasted bug reports. The host and
 * path are what make the error actionable; the userinfo never is.
 *
 * Only the URL form has userinfo to strip. The SCP form (`git@host:path`) has
 * no `//`, so it passes through untouched.
 */
function redactRemote(remoteUrl: string): string {
  return remoteUrl.replace(/\/\/[^/@]*@/, "//");
}

/**
 * Message for a path that would not resolve. Each reason names the fix, because
 * "could not attach" without a next step is the least useful thing we could say.
 */
function describeFailure(
  reason: RepoFailureReason,
  path: string,
  remoteUrl?: string,
): string {
  switch (reason) {
    case "not-a-repo":
      return (
        `"${path}" is not a git repository.\n` +
        `  Clone the repository there, or run \`git init\` and add a GitHub remote.`
      );
    case "no-remote":
      return (
        `"${path}" is a git repository but has no \`origin\` remote.\n` +
        `  Add one with: git -C "${path}" remote add origin git@github.com:<owner>/<repo>.git`
      );
    case "not-github":
      // Two very different causes land here — a non-GitHub forge, and a GHES
      // host this machine has not been told to trust — and the remote alone
      // cannot tell them apart. Naming both beats guessing at one: the fix for
      // whichever it is has to be in the message, because there is no second
      // place a user would think to look.
      return (
        `"${path}" has an \`origin\` bertrand cannot attach to${remoteUrl ? ` (${redactRemote(remoteUrl)})` : ""}.\n` +
        `  Only GitHub remotes are supported. Re-point \`origin\` at a GitHub repository.\n` +
        `  If that host is a GitHub Enterprise Server, declare it in ~/.bertrand/config.json:\n` +
        `      { "github": { "enterpriseHosts": ["github.acme.com"] } }`
      );
  }
}

/**
 * Resolve `path` into a binding the registry will accept, or throw
 * {@link RepoBindError}.
 *
 * `forSlug` is the project about to be bound: re-linking a project to the repo
 * it already points at is a no-op rather than a conflict with itself.
 */
export async function resolveBindableRepo(
  path: string,
  opts: { forSlug?: string } = {},
): Promise<ProjectRepo> {
  const absolute = resolvePath(path);
  const resolution = await resolveRepoAt(absolute);

  if (!resolution.ok) {
    throw new RepoBindError(
      resolution.reason,
      describeFailure(resolution.reason, absolute, resolution.remoteUrl),
    );
  }

  const { repo } = resolution;
  const owner = findProjectByRepo(repo.provider);

  // One project per repo: two projects sharing a repo would race each other on
  // every write keyed by `owner/repo`, and there is no sensible tie-break.
  if (owner && owner.slug !== opts.forSlug) {
    throw new RepoBindError(
      "already-bound",
      `${formatIdentity(repo.provider)} is already attached to project "${owner.slug}".\n` +
        `  One project per repository. Detach it there first, or pick another repo.`,
    );
  }

  return repo;
}
