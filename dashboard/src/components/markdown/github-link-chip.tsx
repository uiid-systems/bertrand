import { Text } from "@uiid/design-system";
import {
  CircleDotIcon,
  GitCommitHorizontalIcon,
  GitPullRequestIcon,
  GithubIcon,
} from "@uiid/icons";
import type { CSSProperties } from "react";

import { githubRefLabel, parseGithubUrl, type GithubRef } from "./github-url";

// Green pill using the semantic "positive" theme tokens (do not invent
// tokens). The Linear chip will be the same shape in purple.
const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "1px 6px 1px 5px",
  border: "1px solid var(--theme-positive-border)",
  borderRadius: "var(--globals-border-radius)",
  background: "var(--theme-positive-surface)",
  textDecoration: "none",
  verticalAlign: "baseline",
  lineHeight: 1,
};

function iconFor(ref: GithubRef) {
  switch (ref.kind) {
    case "pr":
      return <GitPullRequestIcon size={12} color="green" />;
    case "issue":
      return <CircleDotIcon size={12} color="green" />;
    case "commit":
      return <GitCommitHorizontalIcon size={12} color="green" />;
    default:
      return <GithubIcon size={12} color="green" />;
  }
}

/**
 * Renders a bare GitHub URL as a compact entity chip (icon + `owner/repo#123`).
 * Returns a plain link when the URL isn't a recognizable GitHub entity, so it
 * is safe to hand any bare URL. No network — the label is derived from the URL.
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
    <a href={href} target="_blank" rel="noopener noreferrer" style={chipStyle}>
      {iconFor(ref)}
      <Text size={-1} family="mono" color="green">
        {githubRefLabel(ref)}
      </Text>
    </a>
  );
}
