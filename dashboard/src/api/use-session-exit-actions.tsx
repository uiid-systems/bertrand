import { useMutation, useQueryClient } from "@tanstack/react-query";
import { resumeSession, SessionActionError } from "./queries";
import type { SessionRow } from "./types";

/**
 * Reasons worth rewording for the browser. Anything absent here falls through
 * to the server's own message, which is deliberate: `at-capacity`,
 * `already-running` and `no-cwd` all arrive carrying a sentence that names the
 * remedy, and replacing them with a generic string would throw that away.
 */
const REASON_MESSAGE: Record<string, string> = {
  "not-found": "Session not found",
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
 * an undo affordance and an archive/unarchive decision tree that resume has
 * nothing to do with.
 *
 * Resume is all that is left here. Rating went with the ratings system, and
 * discard went with the TUI exit screen it mirrored.
 */
export function useSessionExitActions(session: Pick<SessionRow, "id">) {
  const qc = useQueryClient();

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

  return { resume, describeError };
}
