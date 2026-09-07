import { Link, useParams } from "@tanstack/react-router";

import { Card, Group, ListItem, Text } from "@uiid/design-system";

import type { SessionListRow } from "@/types";

import { statusColor, formatRelativeTime } from "../../../lib/format";

import { SessionLabel } from "./session-label";

type SessionListItemProps = {
  session: SessionListRow;
};

/**
 * One session as a single row: who it is, and when it last did something.
 *
 * It used to carry a second line of metrics — output tokens, files touched,
 * `+added/-removed`. That line is gone and should not come back in that form.
 * The diff half was derived by replaying `tool.applied` events, which the
 * PostToolUse hook only emits for `Edit`/`Write`/`MultiEdit`; a session that
 * edits files through `Bash` (`sed`, heredocs — what Claude is told to prefer
 * under bypassPermissions) records none of them. A quarter of the sessions in
 * the corpus with substantial output therefore reported "0 files", and because
 * the row hid zeroes, the cards that did show numbers implied the blank ones
 * had done nothing. Nor was it a diff: every line of `newStr` counted as added
 * and every line of `oldStr` as removed, both truncated at 4096 chars, so a
 * one-word change in a ten-line block read `+10 -10`.
 *
 * Anything reinstated here needs a source that sees a session's whole effect,
 * not one that infers it from the subset of tools that happen to be hooked.
 */
export const SessionListItem = ({ session: s }: SessionListItemProps) => {
  const isArchived = s.session.status === "archived";
  const color = statusColor(s.session.status);

  // Nothing to do on click beyond navigating. This used to also move the
  // sidebar's project filter to the row's project, so the zone below framed
  // whatever you opened. There is no filter to move: every repo is on screen
  // already and the row is under its own heading.

  // "You are here": the row for the session currently open in the detail view.
  // The route splat is exactly the slug (see findSessionFromSplat).
  const splat = s.session.slug;
  const { _splat } = useParams({ strict: false });
  const isCurrent = (_splat ?? "").replace(/^\/+|\/+$/g, "") === splat;

  // Outline follows status — green (active) / yellow (waiting) / red
  // (blocked on permission), white otherwise.
  const OUTLINE_BY_COLOR: Record<string, string> = {
    green: "var(--color-green)",
    yellow: "var(--color-yellow)",
    red: "var(--color-red)",
  };
  const outlineColor =
    OUTLINE_BY_COLOR[color] ?? "var(--globals-outline-color)";

  return (
    <ListItem
      data-slot="sidebar-session-list-item"
      data-archived={isArchived ? "" : undefined}
      style={isArchived ? { opacity: 0.4 } : undefined}
    >
      <Card
        render={<Link to="/$" params={{ _splat: splat }} />}
        aria-current={isCurrent ? "page" : undefined}
        color={color}
        py={3}
        fullwidth
        style={
          isCurrent
            ? {
                outline: `var(--globals-outline-width) var(--globals-outline-style) ${outlineColor}`,
                outlineOffset: "var(--globals-outline-offset)",
              }
            : undefined
        }
      >
        <Group gap={3} ay="center" fullwidth>
          <SessionLabel session={s} />
          <Text
            size={-1}
            shade="muted"
            ml="auto"
            style={{ whiteSpace: "nowrap" }}
          >
            {formatRelativeTime(s.session.updatedAt)}
          </Text>
        </Group>
      </Card>
    </ListItem>
  );
};
SessionListItem.displayName = "SessionListItem";
