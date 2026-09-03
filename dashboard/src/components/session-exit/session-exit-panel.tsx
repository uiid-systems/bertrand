import { Badge, Button, Group, Stack, Text } from "@uiid/design-system";
import { PlayIcon, PlusIcon } from "@uiid/icons";

import { useArchiveAction } from "../../api/use-archive-action";
import { useSessionExitActions } from "../../api/use-session-exit-actions";
import type { SessionRow } from "../../api/types";
import { formatDuration } from "../../lib/format";
import { parseDbTime } from "@/lib/format";

/**
 * How an exit code reads to a person. 0 is the only unambiguously good one;
 * 130 and 143 are the shell's encoding of SIGINT and SIGTERM (128 + signal),
 * which is what a deliberate Ctrl+C or a `stop` looks like from here and is not
 * a failure. Anything else is reported as-is rather than guessed at.
 */
function describeExit(code: number | null): {
  label: string;
  color: "green" | "neutral" | "red";
} {
  if (code === null) return { label: "ended", color: "neutral" };
  if (code === 0) return { label: "exited cleanly", color: "green" };
  if (code === 130 || code === 143) return { label: "stopped", color: "neutral" };
  return { label: `exit code ${code}`, color: "red" };
}

/**
 * What the terminal zone shows once a session has ended. It arrived as the
 * dashboard's counterpart to a TUI post-exit screen (#214); that screen has
 * since been removed — the terminal now just returns to the shell — so this
 * is the only end-of-session surface, and the only route to resume a session
 * from outside `bertrand` itself.
 *
 * Reads entirely from the session row and the event log, never from a live
 * relay frame. A browser that attaches *after* the session ended never received
 * the `ended` control frame (#215) and must still see this, so the durable
 * record is the only source that works in both cases.
 *
 * There is no "Save" button, and never was one to mirror: `finalize` has
 * already paused the session by the time anything renders. The TUI screen
 * offered Save only because it was a modal gate that something had to
 * dismiss — the reason it is gone. This panel is not a gate, so the
 * equivalent is stating that the work is already saved.
 */
/** One resumable conversation, as the panel needs it. */
export type ResumableConversation = {
  conversationId: string;
  ordinal: number;
  title: string | null;
};

export function SessionExitPanel({
  session,
  exitCode,
  conversationCount,
  conversations,
}: {
  readonly session: SessionRow;
  readonly exitCode: number | null;
  readonly conversationCount: number;
  /** Newest first. Empty is fine — resume then only offers a new conversation. */
  readonly conversations: readonly ResumableConversation[];
}) {
  const archive = useArchiveAction(session);
  const { resume, describeError } = useSessionExitActions(session);

  const exit = describeExit(exitCode);
  const durationSeconds =
    session.endedAt && session.startedAt
      ? (parseDbTime(session.endedAt) - parseDbTime(session.startedAt)) / 1000
      : null;

  return (
    <Stack ax="stretch" fullwidth p={4} gap={4} style={{ overflowY: "auto" }}>
      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Text weight="semibold">Session ended</Text>
          <Badge color={exit.color}>{exit.label}</Badge>
        </Group>
        <Group gap={3} ay="center">
          {durationSeconds !== null && (
            <Text size={-1} shade="muted">
              ran for {formatDuration(durationSeconds)}
            </Text>
          )}
          <Text size={-1} shade="muted">
            {conversationCount} conversation{conversationCount === 1 ? "" : "s"}
          </Text>
        </Group>
      </Stack>

      <Stack gap={2}>
        <Text size={-1} shade="muted">
          Pick up where this left off
        </Text>
        <Stack gap={1} ax="stretch">
          <Button
            size="small"
            variant="subtle"
            loading={resume.isPending && resume.variables === undefined}
            disabled={resume.isPending}
            onClick={() => resume.mutate(undefined)}
          >
            <PlusIcon size={13} />
            New conversation
          </Button>
          {conversations.map((c) => (
            <Button
              key={c.conversationId}
              size="small"
              variant="subtle"
              loading={
                resume.isPending && resume.variables === c.conversationId
              }
              disabled={resume.isPending}
              onClick={() => resume.mutate(c.conversationId)}
            >
              <PlayIcon size={13} />
              <Text truncate>
                Conversation {c.ordinal}
                {c.title ? ` — ${c.title}` : ""}
              </Text>
            </Button>
          ))}
        </Stack>
        {resume.error && (
          // Inline rather than a toast: at capacity the remedy is "stop another
          // session", and that belongs next to the button that just refused.
          <Text size={-1} shade="muted">
            ⚠ {describeError(resume.error)}
          </Text>
        )}
      </Stack>

      <Stack gap={2}>
        <Group gap={2} ay="center">
          <Button
            size="small"
            variant="subtle"
            disabled={archive.disabled}
            loading={archive.loading}
            onClick={archive.onClick}
            tooltip={archive.tooltip}
          >
            <archive.Icon size={13} />
            {archive.label}
          </Button>
        </Group>
        <Text size={-1} shade="muted">
          Saved and paused — it will be here when you come back.
        </Text>
      </Stack>
    </Stack>
  );
}
SessionExitPanel.displayName = "SessionExitPanel";
