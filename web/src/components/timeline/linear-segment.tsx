import { TaskDaily01Icon } from "@hugeicons/core-free-icons";

import { linearIssueUrl } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";

import { TimelineSegment } from "./timeline-event";
import { getMeta } from "./utils";
import { Row } from "./row";
import { SegmentWrapper } from "./subcomponents/segment-wrapper";

export function LinearSegment({ segment }: { segment: TimelineSegment }) {
  const seen = new Set<string>();
  const unique = segment.events.filter((e) => {
    const id = getMeta(e).issue_id || e.summary;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return (
    <Row
      ts={segment.ts}
      icon={TaskDaily01Icon}
      iconColor="text-(--event-purple)"
    >
      <SegmentWrapper className="border-(--event-purple)!">
        {unique.map((e, idx) => {
          const m = getMeta(e);
          const id = m.issue_id || e.summary || "issue";
          const title =
            m.issue_title && !/^PR #\d+/.test(m.issue_title)
              ? m.issue_title
              : null;
          const url = m.issue_id ? linearIssueUrl(m.issue_id) : null;

          return (
            <div key={idx} className="flex items-center gap-1.5">
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <Badge
                    variant="secondary"
                    className="text-[var(--event-purple)] hover:bg-accent cursor-pointer shrink-0"
                  >
                    {id}
                  </Badge>
                </a>
              ) : (
                <Badge
                  variant="secondary"
                  className="text-[var(--event-purple)] shrink-0"
                >
                  {id}
                </Badge>
              )}
              {title && (
                <span className="text-foreground text-[11px] truncate">
                  {title}
                </span>
              )}
            </div>
          );
        })}
      </SegmentWrapper>
    </Row>
  );
}
