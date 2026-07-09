import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Group, Text, useToastManager } from "@uiid/design-system";
import { ArchiveIcon, ArchiveRestoreIcon, type Icon } from "@uiid/icons";
import { archiveSession, ArchiveError, unarchiveSession } from "./queries";
import type { SessionRow } from "./types";

const REASON_MESSAGE: Record<string, string> = {
  "not-found": "Session not found",
  active: "End the session before archiving",
  "already-archived": "Session is already archived",
  "not-archived": "Session is not archived",
  unknown: "Something went wrong",
};

function describeError(err: unknown): string {
  if (err instanceof ArchiveError) {
    return REASON_MESSAGE[err.reason] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export type ArchiveActionKind = "archive" | "unarchive";

export type ArchiveAction = {
  kind: ArchiveActionKind;
  label: string;
  tooltip: string;
  Icon: Icon;
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
};

/**
 * Returns the appropriate archive/unarchive action for a session.
 *
 * Owns the full decision tree (status → verb + label + disabled state + handler),
 * the mutations, cache invalidation, and toast feedback. Different UI surfaces
 * (button, menu item, etc.) bind the same hook output and stay in lockstep.
 *
 * On success, the toast includes an inline Undo button that runs the inverse
 * mutation silently (no follow-up toast).
 */
export function useArchiveAction(
  session: Pick<SessionRow, "id" | "slug" | "status">,
): ArchiveAction {
  const qc = useQueryClient();
  const toast = useToastManager();

  const invalidate = () => qc.invalidateQueries({ queryKey: ["sessions"] });

  // Silent inverse — used by the Undo button so we don't double-toast.
  const runSilent = (verb: ArchiveActionKind) => {
    const fn = verb === "archive" ? archiveSession : unarchiveSession;
    return fn(session.id)
      .then(invalidate)
      .catch((err) => {
        toast.add({
          description: `Undo failed: ${describeError(err)}`,
          priority: "high",
        });
      });
  };

  const successToast = (
    didVerb: "Archived" | "Unarchived",
    undoVerb: ArchiveActionKind,
  ) => {
    let toastId: string | undefined;
    const onUndo = () => {
      if (toastId) toast.close(toastId);
      void runSilent(undoVerb);
    };
    toastId = toast.add({
      priority: "low",
      description: (
        <Group ay="center" gap={3} ax="space-between" fullwidth>
          <Text>
            {didVerb} <code>{session.slug}</code>
          </Text>
          <Button size="small" onClick={onUndo}>
            Undo
          </Button>
        </Group>
      ),
    });
  };

  const archive = useMutation({
    mutationFn: () => archiveSession(session.id),
    onSuccess: () => {
      invalidate();
      successToast("Archived", "unarchive");
    },
    onError: (err) =>
      toast.add({
        description: `Could not archive ${session.slug}: ${describeError(err)}`,
        priority: "high",
      }),
  });

  const unarchive = useMutation({
    mutationFn: () => unarchiveSession(session.id),
    onSuccess: () => {
      invalidate();
      successToast("Unarchived", "archive");
    },
    onError: (err) =>
      toast.add({
        description: `Could not unarchive ${session.slug}: ${describeError(err)}`,
        priority: "high",
      }),
  });

  if (session.status === "archived") {
    return {
      kind: "unarchive",
      label: "Unarchive",
      tooltip: "Unarchive (returns to paused)",
      Icon: ArchiveRestoreIcon,
      disabled: false,
      loading: unarchive.isPending,
      onClick: () => unarchive.mutate(),
    };
  }

  const isLive =
    session.status === "active" ||
    session.status === "waiting" ||
    session.status === "blocked";
  return {
    kind: "archive",
    label: "Archive",
    tooltip: isLive
      ? "End the session before archiving"
      : "Archive this session",
    Icon: ArchiveIcon,
    disabled: isLive,
    loading: archive.isPending,
    onClick: () => archive.mutate(),
  };
}
