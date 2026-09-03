import { useQuery } from "@tanstack/react-query";

import { Button, Card, Badge, Group, Status, Text } from "@uiid/design-system";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  ArrowUpRightIcon,
} from "@uiid/icons";

import { pullRequestQuery } from "../../api/queries";
import type {
  CheckRollupState,
  GhFailureReason,
  PullRequest,
  PullRequestCheck,
} from "../../api/types";

export type PullRequestCardProps = {
  /** The session the sidebar belongs to — its branch is the one looked up. */
  sessionId: string;
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
 *
 * The state reaches the user three ways — the card's hue, its icon, and the
 * `label` in the link's tooltip. The hue alone would be the one that fails
 * anyone who can't separate the colors, and the icons differ in shape
 * (open/draft/closed/merged) rather than only in tint for that reason.
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
 * These render nothing. A permanent "PR status unavailable" card under every
 * session — because `gh` isn't installed, or the host was undeclared — is
 * exactly the empty scaffolding this card is meant to avoid, and it isn't news
 * a second time. Everything else (not signed in, rate limited, offline, a
 * timeout) does surface, because those clear and the message names the fix.
 */
const SILENT_FAILURES = new Set<GhFailureReason>([
  "gh-missing",
  "untrusted-host",
]);

/**
 * The pull request for a session's branch, as a card: number, title, state,
 * and check rollup, with the whole card linking out to the PR.
 *
 * Lives with "Files changed" because the two answer the same question — what
 * this session is proposing to merge — and the branch's diff is the PR's diff.
 *
 * A card rather than a row because it is a different *kind* of thing from the
 * file list beneath it: the files are a table, and giving the PR its own
 * surface separates the branch's summary from the branch's contents without
 * needing a rule or a heading to do it.
 *
 * Renders nothing at all when the branch has no PR, which is most branches.
 * The zones around it are fixed landmarks that state their own emptiness; this
 * card is the opposite, and deliberately so: "no pull request" is the default
 * state of a session and saying it on every one of them would be noise.
 */
export const PullRequestCard = ({ sessionId }: PullRequestCardProps) => {
  const { data } = useQuery(pullRequestQuery(sessionId));

  if (!data || data.status === "none") {
    return null;
  }

  if (data.status === "unavailable") {
    if (SILENT_FAILURES.has(data.reason)) {
      return null;
    }
    return (
      <Group px={2} fullwidth>
        <Card
          data-slot="pull-request-card"
          variant="ghost"
          title="PR status unavailable"
          TitleProps={{
            size: -1,
            shade: "muted",
            truncate: true,
            title: data.message,
          }}
          fullwidth
        />
      </Group>
    );
  }

  const pr = data.pullRequest;
  const { label, color, Icon } = present(pr);
  const done = finished(pr.checks);

  const Title = () => (
    <Group ay="center" gap={2} fullwidth>
      <Group ay="center" gap={4}>
        <Text size={1} weight="bold">
          #{pr.number}: {label}
        </Text>
        {pr.rollup === "none" ? undefined : (
          <Group ay="center" gap={1}>
            <Status color={ROLLUP_COLOR[pr.rollup]} />
            <Text size={-1} family="mono">
              {`${done}/${pr.checks.length}`}
            </Text>
          </Group>
        )}
      </Group>
    </Group>
  );

  const Actions = () => (
    <Group gap={2}>
      <Button
        nativeButton={false}
        render={<a href={pr.url} target="_blank" rel="noreferrer" />}
        size="xsmall"
        variant="ghost"
      >
        View in GitHub
        <ArrowUpRightIcon />
      </Button>
    </Group>
  );

  return (
    <Card
      data-slot="pull-request-card"
      icon={Icon}
      py={2}
      pr={2}
      HeaderProps={{ ay: "center" }}
      title={<Title />}
      action={<Actions />}
      color={color}
      fullwidth
    />
  );
};
PullRequestCard.displayName = "PullRequestCard";
