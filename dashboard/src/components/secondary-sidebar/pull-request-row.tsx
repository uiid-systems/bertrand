import { useQuery } from "@tanstack/react-query";

import { Badge, Group, Status, Text } from "@uiid/design-system";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "@uiid/icons";

import { pullRequestQuery } from "../../api/queries";
import type {
  CheckRollupState,
  GhFailureReason,
  PullRequest,
  PullRequestCheck,
} from "../../api/types";

export type PullRequestRowProps = {
  /** The session the sidebar belongs to — its branch is the one looked up. */
  sessionId: string;
  /** Project the session belongs to, so the branch resolves against the right DB. */
  projectSlug?: string;
};

type Presentation = {
  label: string;
  color: "green" | "purple" | "red" | "neutral";
  Icon: typeof GitPullRequestIcon;
};

/**
 * A draft is its own state here even though GitHub models it as a flag on an
 * open PR: "open" invites review and a draft explicitly doesn't, so drawing
 * them the same would misreport what the PR is asking for.
 */
function present(pr: PullRequest): Presentation {
  if (pr.state === "MERGED") {
    return { label: "merged", color: "purple", Icon: GitMergeIcon };
  }
  if (pr.state === "CLOSED") {
    return { label: "closed", color: "red", Icon: GitPullRequestClosedIcon };
  }
  if (pr.isDraft) {
    return { label: "draft", color: "neutral", Icon: GitPullRequestDraftIcon };
  }
  return { label: "open", color: "green", Icon: GitPullRequestIcon };
}

const ROLLUP_COLOR: Record<
  Exclude<CheckRollupState, "none">,
  "green" | "red" | "yellow"
> = {
  pass: "green",
  fail: "red",
  pending: "yellow",
};

/**
 * Checks are counted as *finished*, not as passed.
 *
 * The dot already carries the verdict, so the number's job is progress —
 * "2/4" beside a yellow dot says the suite is halfway, which is the thing
 * worth watching. Counting passes instead would render a green PR whose
 * checks include a skipped job as "3/4", reading as a partial failure.
 */
const finished = (checks: PullRequestCheck[]) =>
  checks.filter((check) => check.bucket !== "pending").length;

/**
 * Failures that mean bertrand has no GitHub to talk to on this machine at all,
 * as opposed to a call that could succeed later.
 *
 * These render nothing. A permanent "PR status unavailable" line under every
 * session — because `gh` isn't installed, or the host was undeclared — is
 * exactly the empty scaffolding this row is meant to avoid, and it isn't news
 * a second time. Everything else (not signed in, rate limited, offline, a
 * timeout) does surface, because those clear and the message names the fix.
 */
const SILENT_FAILURES = new Set<GhFailureReason>([
  "gh-missing",
  "untrusted-host",
]);

/**
 * The pull request for a session's branch: number, state, and check rollup,
 * linking out to the PR.
 *
 * Lives with "Files changed" rather than with the worktree because the two
 * answer the same question — what this session is proposing to merge — and
 * the branch's diff is the PR's diff.
 *
 * Renders nothing at all when the branch has no PR, which is most branches.
 * The zones around it are fixed landmarks that state their own emptiness; this
 * row is the opposite, and deliberately so: "no pull request" is the default
 * state of a session and saying it on every one of them would be noise.
 */
export const PullRequestRow = ({
  sessionId,
  projectSlug,
}: PullRequestRowProps) => {
  const { data } = useQuery(pullRequestQuery(sessionId, projectSlug));

  if (!data || data.status === "none") {
    return null;
  }

  if (data.status === "unavailable") {
    if (SILENT_FAILURES.has(data.reason)) {
      return null;
    }
    return (
      <Group data-slot="pull-request-row" px={2} fullwidth>
        {/* Stated, never alarmed: this is "we don't know", and the specific
            reason — with its fix — is one hover away. */}
        <Text size={-1} shade="muted" truncate title={data.message}>
          PR status unavailable
        </Text>
      </Group>
    );
  }

  const pr = data.pullRequest;
  const { label, color, Icon } = present(pr);
  const done = finished(pr.checks);

  return (
    <Group data-slot="pull-request-row" ay="center" gap={2} px={2} fullwidth>
      <Group ay="center" gap={2} minw={0}>
        <Icon size={13} />
        <Text
          size={-1}
          weight="bold"
          title={pr.title}
          render={<a href={pr.url} target="_blank" rel="noreferrer" />}
        >
          {`#${pr.number}`}
        </Text>
        <Text size={-1} shade="muted" truncate title={pr.title}>
          {pr.title}
        </Text>
      </Group>

      <Group ay="center" gap={2} ml="auto">
        {/* `none` is a PR nobody configured checks for — distinct from a green
            one, and drawing a dot for it would claim a pass that never ran. */}
        {pr.rollup !== "none" && (
          <Group ay="center" gap={1} title={`${done} of ${pr.checks.length} checks finished`}>
            <Status color={ROLLUP_COLOR[pr.rollup]} />
            <Text size={-1} family="mono" shade="muted">
              {`${done}/${pr.checks.length}`}
            </Text>
          </Group>
        )}
        <Badge color={color}>{label}</Badge>
      </Group>
    </Group>
  );
};
PullRequestRow.displayName = "PullRequestRow";
