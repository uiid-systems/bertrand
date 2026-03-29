import { HugeiconsIcon } from "@hugeicons/react";
import { GitMergeIcon, GitPullRequestIcon } from "@hugeicons/core-free-icons";

import { Group, Text } from "@uiid/design-system";

import { Badge } from "@uiid/design-system";
import { githubPrUrl } from "@/lib/constants";

import { TimelineSegment } from "./timeline-event";
import { getMeta } from "./utils";
import { Row } from "./row";
import { SegmentWrapper } from "./subcomponents/segment-wrapper";

type PrSegmentProps = {
  segment: TimelineSegment;
  repoBase?: string;
};

export function PrSegment({ segment, repoBase }: PrSegmentProps) {
  const e = segment.events[0];
  const m = getMeta(e);
  const isMerged = e.event === "gh.pr.merged";
  const prNum = m.pr_number ? `#${m.pr_number}` : null;
  // Use pr_url if available; fall back to repoBase, then constants
  const prUrl =
    m.pr_url ||
    (repoBase && m.pr_number ? `${repoBase}/pull/${m.pr_number}` : null) ||
    (m.pr_number ? githubPrUrl(m.pr_number) : null);
  const icon = isMerged ? GitMergeIcon : GitPullRequestIcon;
  const color = isMerged
    ? "text-[var(--event-purple)]"
    : "text-[var(--event-green)]";

  const prTitle = m.pr_title || null;

  return (
    <Row data-slot="pr-segment" ts={segment.ts} icon={icon} iconColor={color}>
      <SegmentWrapper className="border-(--event-green)!">
        <Group gap={2} ay="center">
          {prNum && prUrl ? (
            <a href={prUrl} target="_blank" rel="noopener noreferrer">
              <Badge
                color="green"
                size="small"
                className="cursor-pointer"
              >
                <HugeiconsIcon icon={icon} size={10} />
                {prNum}
              </Badge>
            </a>
          ) : prNum ? (
            <Badge color="green" size="small">{prNum}</Badge>
          ) : null}
          {prTitle && (
            <Text size={-1} shade="halftone">
              {prTitle}
            </Text>
          )}
          {!prTitle && m.branch && (
            <Badge color="green" size="small">
              {m.branch}
            </Badge>
          )}
          <Text size={-1} shade="halftone">
            {isMerged ? "merged" : "opened"}
          </Text>
        </Group>
      </SegmentWrapper>
    </Row>
  );
}
