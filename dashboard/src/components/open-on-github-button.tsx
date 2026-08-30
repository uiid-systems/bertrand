import { useQuery } from "@tanstack/react-query";
import { Button, type ButtonProps } from "@uiid/design-system";
import { GithubIcon, TriangleAlertIcon } from "@uiid/icons";

import { projectsQuery } from "../api/queries";
import type { ProjectRepoView } from "../api/types";

type OpenOnGithubButtonProps = Omit<ButtonProps, "render" | "children"> & {
  /**
   * Which project the session belongs to. Omitted for single-project reads,
   * where the registry's active project *is* the session's project — the same
   * fallback the breadcrumb's project name uses.
   */
  projectSlug?: string;
};

/**
 * Web URL of a bound repo's root.
 *
 * Unlike the display `label` — which the server formats, because prefixing the
 * host is an enterprise-only rule — the URL takes the host unconditionally and
 * defaults to github.com, so there is no branching rule to keep in one place.
 */
function repoWebUrl(repo: ProjectRepoView): string {
  const { host, owner, repo: name } = repo.provider;
  return `https://${host ?? "github.com"}/${owner}/${name}`;
}

/**
 * Open a session's project on GitHub in a new tab.
 *
 * The repo *root*, not the session's branch: a session's branch is a
 * local one until something pushes it, so linking it would send you to a 404
 * for exactly the sessions still in progress. The root is always there.
 *
 * The target comes from the project's repo binding, the only place bertrand
 * records which repo a project is. An unbound project has nothing to open, so
 * the button stays visible and disabled, naming the missing binding rather than
 * vanishing — same treatment as {@link OpenInEditorButton}.
 *
 * A binding whose host this machine no longer vouches for is disabled too, and
 * drops the GitHub mark: a host can be named to read like github.com, and
 * navigating somewhere on that machine's say-so is the one thing this button
 * must not do.
 */
export const OpenOnGithubButton = ({
  projectSlug,
  size = "small",
  variant = "ghost",
  shape = "square",
  ...rest
}: OpenOnGithubButtonProps) => {
  const { data: projects = [] } = useQuery(projectsQuery);

  const project = projectSlug
    ? projects.find((p) => p.slug === projectSlug)
    : projects.find((p) => p.active);

  const repo = project?.repo ?? null;
  const trusted = repo?.hostTrusted ?? false;
  const href = repo && trusted ? repoWebUrl(repo) : null;

  const label = repo ? `Open ${repo.label} on GitHub` : "Open on GitHub";

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
          : repo
            ? `${repo.label} — unverified host, not opening`
            : "No repo attached to this project — nothing to open"
      }
      // Stays a real <button> without a target — an anchor ignores `disabled`
      // and would navigate anyway.
      render={
        href ? <a href={href} target="_blank" rel="noreferrer" /> : undefined
      }
      {...rest}
    >
      {repo && !trusted ? (
        <TriangleAlertIcon size={13} />
      ) : (
        <GithubIcon size={13} />
      )}
    </Button>
  );
};
OpenOnGithubButton.displayName = "OpenOnGithubButton";
