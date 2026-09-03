import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToastManager } from "@uiid/design-system";
import {
  discardSession,
  resumeSession,
  SessionActionError,
} from "./queries";
import type { SessionRow } from "./types";

/**
 * Reasons worth rewording for the browser. Anything absent here falls through
 * to the server's own message, which is deliberate: `at-capacity`,
 * `already-running` and `no-cwd` all arrive carrying a sentence that names the
 * remedy, and replacing them with a generic string would throw that away.
 */
const REASON_MESSAGE: Record<string, string> = {
  "not-found": "Session not found",
  "out-of-range": "Rating must be between 1 and 5",
  active: "Stop the session before discarding it",
  unknown: "Something went wrong",
};

function describeError(err: unknown): string {
  if (err instanceof SessionActionError) {
    return REASON_MESSAGE[err.reason] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/**
 * The end-of-session actions that aren't archive (#214) — archive already has
 * `useArchiveAction`, and this deliberately does not absorb it: that hook owns
 * an undo affordance and an archive/unarchive decision tree that have nothing
 * to do with deleting.
 *
 * Rating is optimistic. It is a single integer with no server-side derivation,
 * and the alternative is a star that visibly lags the click on every press.
 * The `sessions` cache is the source of truth the panel renders from, so the
 * patch goes there and is rolled back on failure.
 */
export function useSessionExitActions(
  session: Pick<SessionRow, "id" | "slug">,
  opts: { onDiscarded?: () => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToastManager();

  const discard = useMutation({
    mutationFn: () => discardSession(session.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sessions"] });
      toast.add({
        description: `Discarded ${session.slug}`,
        priority: "low",
      });
      // No undo offered: the row and everything cascading from it is gone, so
      // a button promising to bring it back would be lying.
      opts.onDiscarded?.();
    },
    onError: (err) =>
      toast.add({
        description: `Could not discard ${session.slug}: ${describeError(err)}`,
        priority: "high",
      }),
  });

  const resume = useMutation({
    // `undefined` means "start a new conversation under this session".
    mutationFn: (conversationId?: string) =>
      resumeSession(session.id, conversationId),
    onSuccess: () => {
      // The session is live again. The route polls every 2s and swaps this
      // panel for the terminal when it notices; invalidating makes that
      // immediate rather than leaving the user looking at a stale exit panel.
      qc.invalidateQueries({ queryKey: ["sessions"] });
      qc.invalidateQueries({ queryKey: ["events", session.id] });
    },
    // No toast: the failure is rendered inline in the panel, next to the button
    // that caused it, where the remedy ("stop another session") is actionable.
  });

  return { discard, resume, describeError };
}
