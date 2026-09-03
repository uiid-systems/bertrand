import { Group, Text } from "@uiid/design-system";
import type { SessionListRow } from "@/types";

type SessionLabelProps = {
  session: SessionListRow;
};

/**
 * The card's title: the session slug, plus the branch it ran on.
 *
 * The branch is the second line of identity now, not decoration. A session *is*
 * a unit of work keyed on `(repo, branch)`, and its slug is a name derived at
 * pause that may say considerably less than `feature/ui-505` does — while the
 * repo half of that key is already spelled out by the group header above, so
 * repeating it on every card would be noise.
 *
 * Absent when the session's cwd was not in a repo, which is ordinary: the row
 * then reads as slug-only, the same as every row did before.
 *
 * The hover title carries the full `groupKey` — the one place the repo and
 * branch are written out together.
 */
export const SessionLabel = ({ session: s }: SessionLabelProps) => {
  const { slug, branch, groupKey } = s.session;

  return (
    <Group ay="center" gap={2} style={{ minWidth: 0 }}>
      <Text
        title={groupKey ?? slug}
        weight="semibold"
        size={-1}
        truncate
        style={{ minWidth: 0 }}
      >
        {slug}
      </Text>
      {branch && (
        <Text
          size={-1}
          shade="muted"
          family="mono"
          truncate
          title={branch}
          style={{ minWidth: 0 }}
        >
          {branch}
        </Text>
      )}
    </Group>
  );
};
SessionLabel.displayName = "SessionLabel";
