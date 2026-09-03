import { Button, type ButtonProps } from "@uiid/design-system";
import { GithubIcon, TriangleAlertIcon } from "@uiid/icons";

import type { SessionRow } from "../api/types";

type OpenOnGithubButtonProps = Omit<ButtonProps, "render" | "children"> & {
  session: SessionRow;
};

/**
 * Web URL for a session's `repo`, or null when this page must not derive one.
 *
 * `repo` is `formatIdentity()` output written at session start: `owner/repo` for
 * github.com, `host/owner/repo` for GitHub Enterprise (the host may carry a
 * port). Render it verbatim — the host prefix is already in the string and
 * reformatting it here would duplicate a rule `@/lib/github/identity` owns.
 *
 * Only the two-segment, github.com form yields a URL. A host-prefixed value
 * names a GHES install that was declared on this machine when the session
 * started, and nothing the browser can see says it still is — a host can be
 * named to read like github.com, and navigating somewhere on a stale
 * declaration's say-so is the one thing this button must not do. The server
 * used to re-check that per project and send a `hostTrusted` flag; there is no
 * project to hang one on, and no per-session equivalent on the wire yet.
 */
function repoWebUrl(repo: string | null): string | null {
  if (!repo) return null;
  const segments = repo.split("/");
  if (segments.length !== 2) return null;
  return `https://github.com/${segments[0]}/${segments[1]}`;
}

/**
 * Open a session's repo on GitHub in a new tab.
 *
 * The repo *root*, not the session's branch: a session's branch is a local one
 * until something pushes it, so linking it would send you to a 404 for exactly
 * the sessions still in progress. The root is always there.
 *
 * The target is read off the session row, which records the repo its cwd
 * resolved to at start. It used to come from the project's repo binding — a
 * thing a human bound by hand, and could bind to the wrong repo or forget to
 * bind at all. A session outside git has no repo, so the button stays visible
 * and disabled, naming what's missing rather than vanishing — same treatment as
 * {@link OpenInEditorButton}.
 */
export const OpenOnGithubButton = ({
  session,
  size = "small",
  variant = "ghost",
  shape = "square",
  ...rest
}: OpenOnGithubButtonProps) => {
  const repo = session.repo;
  const href = repoWebUrl(repo);
  // A repo bertrand recorded but this page won't navigate to: an enterprise
  // host it cannot vouch for from here.
  const unverifiable = repo !== null && href === null;

  const label = repo ? `Open ${repo} on GitHub` : "Open on GitHub";

  return (
    <Button
      size={size}
      variant={variant}
      shape={shape}
      disabled={!href}
      aria-label={label}
      tooltip={
        href
          ? label
          : unverifiable
            ? `${repo} — enterprise host, not opening from the browser`
            : "This session didn't run in a GitHub repo — nothing to open"
      }
      // Stays a real <button> without a target — an anchor ignores `disabled`
      // and would navigate anyway.
      render={
        href ? <a href={href} target="_blank" rel="noreferrer" /> : undefined
      }
      {...rest}
    >
      {unverifiable ? (
        <TriangleAlertIcon size={13} />
      ) : (
        <GithubIcon size={13} />
      )}
    </Button>
  );
};
OpenOnGithubButton.displayName = "OpenOnGithubButton";
