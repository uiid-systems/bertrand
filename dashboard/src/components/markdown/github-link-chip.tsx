import { SiGithub } from "@icons-pack/react-simple-icons";

import { githubRefLabel, parseGithubUrl } from "./github-url";
import { LinkChip } from "./link-chip";

/**
 * Renders a bare GitHub URL as a compact green entity chip (GitHub mark +
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
      icon={<SiGithub size={12} />}
      label={githubRefLabel(ref)}
      tone="green"
    />
  );
}
