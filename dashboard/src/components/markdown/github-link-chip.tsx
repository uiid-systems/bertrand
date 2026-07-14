import {
  CircleDotIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  GithubIcon,
} from "@uiid/icons";

import { githubRefLabel, parseGithubUrl, type GithubRef } from "./github-url";
import { LinkChip } from "./link-chip";

function iconFor(ref: GithubRef) {
  switch (ref.kind) {
    case "pr":
      return <GitPullRequestIcon size={12} />;
    case "issue":
      return <CircleDotIcon size={12} />;
    case "commit":
      return <GitCommitHorizontalIcon size={12} />;
    default:
      return <GithubIcon size={12} />;
  }
}

/**
 * Renders a bare GitHub URL as a compact green entity chip (icon +
 * `owner/repo#123`). Falls back to a plain link when the URL isn't a
 * recognizable GitHub entity. No network — the label comes from the URL.
 */
export function GithubLinkChip({ href }: { href: string }) {
  const ref = parseGithubUrl(href);

  if (!ref) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>
    );
  }

  return (
    <LinkChip
      href={href}
      icon={iconFor(ref)}
      label={githubRefLabel(ref)}
      tone="green"
    />
  );
}
