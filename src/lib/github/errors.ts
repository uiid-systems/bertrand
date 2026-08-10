/**
 * Failure vocabulary for the `gh` transport, and the rules that map a dead
 * subprocess onto it.
 *
 * A leaf on purpose, like `./types`: this module imports nothing, so a caller
 * that needs only the shape of a failure — a route handler, a dashboard type —
 * can reach it without pulling in the runner and, through it, `fs`.
 *
 * Classification is text matching against `gh`'s stderr, which is a contract
 * `gh` never promised us. It is still the right trade: `gh` is the transport
 * precisely because it carries the user's existing auth, and the alternative is
 * an OAuth app and a token store. Every rule below is written to fail toward
 * {@link GhFailureReason} `unknown`, which callers must already handle, so a
 * reworded message costs a worse label and never a crash.
 */

/**
 * Why a `gh` invocation did not produce output. Each maps to a distinct
 * user-facing fix, which is the whole reason the union exists rather than a
 * boolean: `not-authenticated` → `gh auth login`, `gh-missing` → install it,
 * `rate-limited` → wait, `network` → check the connection.
 */
export type GhFailureReason =
  /** No `gh` on PATH, or one that cannot be executed. */
  | "gh-missing"
  /** No credentials, expired credentials, or credentials lacking the scope. */
  | "not-authenticated"
  /** The resource is absent — or private and invisible to these credentials. */
  | "not-found"
  /** Primary or secondary rate limit; the same request may work later. */
  | "rate-limited"
  /** DNS, TCP, TLS, or a 5xx from the far end. */
  | "network"
  /** The process outlived its budget and was killed. */
  | "timed-out"
  /** The host is no longer one this machine declares as GitHub Enterprise. */
  | "untrusted-host"
  /** `gh` exited clean but its stdout was not the JSON we asked for. */
  | "invalid-json"
  /** Classified nothing; the message is all the caller gets. */
  | "unknown";

/** The failure arm of {@link GhResult}. */
export interface GhFailure {
  ok: false;
  reason: GhFailureReason;
  /**
   * One line, already stripped of `gh`'s own prefix, safe to show a user.
   * Never empty — a silent failure is the one thing a UI cannot render.
   */
  message: string;
  /** The process's exit code, when a process actually ran. */
  exitCode?: number;
}

/**
 * What every `gh` call returns. There is no throwing arm by design: the
 * dashboard polls this layer, and an exception on a poll blanks the UI over a
 * rate limit that would have cleared on its own.
 */
export type GhResult<T> = { ok: true; value: T } | GhFailure;

/**
 * `gh` prefixes its own diagnostics with `gh: `. Strip it so messages read as
 * bertrand's, not as a leaked subprocess.
 */
const GH_PREFIX = /^gh:\s*/;

/** Fallbacks for when `gh` died without saying anything on stderr. */
const DEFAULT_MESSAGES: Record<GhFailureReason, string> = {
  "gh-missing": "The GitHub CLI (gh) is not installed or not on PATH.",
  "not-authenticated": "GitHub CLI is not authenticated. Run `gh auth login`.",
  "not-found": "GitHub returned 404 for that resource.",
  "rate-limited": "GitHub API rate limit exceeded.",
  network: "Could not reach GitHub.",
  "timed-out": "The GitHub CLI did not respond in time.",
  "untrusted-host": "That host is not declared as a GitHub Enterprise Server host.",
  "invalid-json": "The GitHub CLI returned output that was not valid JSON.",
  unknown: "The GitHub CLI failed.",
};

/**
 * `gh` reserves exit code 4 for "you are not authenticated", the one signal it
 * gives us that does not depend on message wording.
 */
const EXIT_AUTH_REQUIRED = 4;

/** Phrases that only appear when a limit, not a permission, denied the call. */
const RATE_LIMIT_MARKERS = [
  "rate limit",
  "rate_limited",
  "http 429",
  "abuse detection",
];

const AUTH_MARKERS = [
  "gh auth login",
  "gh_token",
  "github_token",
  "authentication",
  "authenticate",
  "bad credentials",
  "not logged in",
  "required scopes",
  "not been granted",
  "saml enforcement",
  "http 401",
  "http 403",
];

const NOT_FOUND_MARKERS = [
  "http 404",
  "not found",
  "could not resolve to a",
  "no such repository",
];

const NETWORK_MARKERS = [
  // `gh` replaces the underlying Go error with this pair for connection
  // failures, so they are the shape most network trouble actually arrives in.
  "error connecting to",
  "check your internet connection",
  "dial tcp",
  "no such host",
  "connection refused",
  "connection reset",
  "network is unreachable",
  "i/o timeout",
  "context deadline exceeded",
  "temporary failure in name resolution",
  "tls handshake",
  "x509",
  "certificate",
  "proxyconnect",
  "unexpected eof",
  "http 500",
  "http 502",
  "http 503",
  "http 504",
];

function matches(haystack: string, markers: readonly string[]): boolean {
  return markers.some((marker) => haystack.includes(marker));
}

/**
 * The reason a `gh` process that ran and exited non-zero failed.
 *
 * Order encodes the ambiguities. A rate limit arrives as HTTP 403, the same
 * status as a permission failure, so the limit markers are checked first — a
 * user told to re-authenticate when they should have waited will burn their
 * credentials looking for a problem that is not there. A private repository
 * returns 404 to credentials that cannot see it, which is indistinguishable
 * from a deleted one; `not-found` is the honest label for both.
 */
export function classifyExit(exitCode: number, stderr: string): GhFailureReason {
  const text = stderr.toLowerCase();

  if (matches(text, RATE_LIMIT_MARKERS)) {
    return "rate-limited";
  }
  if (exitCode === EXIT_AUTH_REQUIRED || matches(text, AUTH_MARKERS)) {
    return "not-authenticated";
  }
  if (matches(text, NOT_FOUND_MARKERS)) {
    return "not-found";
  }
  if (matches(text, NETWORK_MARKERS)) {
    return "network";
  }

  return "unknown";
}

/**
 * The reason `gh` never started.
 *
 * A binary that exists but cannot be executed is reported as `gh-missing`
 * rather than a separate reason: the user-facing fix — install or repair the
 * GitHub CLI — is the same, and the distinction only matters to whoever broke
 * the permissions, who has the message to go on.
 */
export function classifySpawnError(error: unknown): GhFailureReason {
  const code = (error as { code?: unknown } | null)?.code;
  const text = `${code ?? ""} ${error instanceof Error ? error.message : String(error ?? "")}`.toLowerCase();

  if (
    text.includes("enoent") ||
    text.includes("eacces") ||
    text.includes("not found") ||
    text.includes("no such file")
  ) {
    return "gh-missing";
  }

  return "unknown";
}

/**
 * Build a failure, preferring `gh`'s own first line of stderr over our generic
 * copy — it is usually more specific than anything we could write, and it is
 * what a user would see running the command by hand.
 */
export function ghFailure(
  reason: GhFailureReason,
  detail?: string,
  exitCode?: number,
): GhFailure {
  const firstLine = (detail ?? "")
    .split("\n")
    .map((line) => line.trim().replace(GH_PREFIX, ""))
    .find((line) => line.length > 0);

  const failure: GhFailure = {
    ok: false,
    reason,
    message: firstLine || DEFAULT_MESSAGES[reason],
  };

  if (exitCode !== undefined) {
    failure.exitCode = exitCode;
  }

  return failure;
}
