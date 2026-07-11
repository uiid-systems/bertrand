import { getAllSessions, setSessionSummary } from "@/db/queries/sessions";
import { deriveSessionSummary } from "@/lib/summary";
import { formatAgo } from "@/lib/format";

/**
 * Sibling sessions context layer, injected into every session's contract.
 *
 * Project-wide (docs/agent-cli.md, Spec 2): a session's relevant neighbors
 * are rarely confined to its own category, so every non-archived session in
 * the active project gets a line — capped so the block stays a few hundred
 * tokens. Summaries come from the pause-time derivation in lib/summary.ts.
 * Archived sessions are excluded from injection; they stay discoverable via
 * `bertrand list --all`.
 */

const MAX_SIBLINGS = 12;

export function buildSiblingContext(currentSessionId: string): string {
  const rows = getAllSessions({ excludeArchived: true })
    .filter((r) => r.session.id !== currentSessionId)
    .sort(
      (a, b) =>
        new Date(b.session.updatedAt).getTime() -
        new Date(a.session.updatedAt).getTime(),
    );

  if (rows.length === 0) return "";

  const shown = rows.slice(0, MAX_SIBLINGS);
  const lines = shown.map(({ session: s, categoryPath }) => {
    const ago = s.updatedAt ? formatAgo(s.updatedAt) : "unknown";
    // Lazy backfill: sessions paused before the pause-time derivation existed
    // have a NULL summary — heal them the first time they render as siblings.
    // Guarded: this runs on the session-launch path, and a SQLITE_BUSY from a
    // neighbor's metadata upkeep must never prevent this session's start.
    let summaryText = s.summary;
    if (!summaryText) {
      try {
        summaryText = deriveSessionSummary(s.id);
        if (summaryText) setSessionSummary(s.id, summaryText);
      } catch {
        summaryText = null;
      }
    }
    const summary = summaryText ? ` — "${summaryText}"` : "";
    const worktree = s.worktreeBranch ? ` [worktree: ${s.worktreeBranch}]` : "";
    return `- ${categoryPath}/${s.slug}: ${s.status}${worktree}${summary} (${ago})`;
  });

  if (rows.length > shown.length) {
    lines.push(`- …plus ${rows.length - shown.length} more — run \`bertrand list\``);
  }

  const guidance = [
    "",
    "To inspect a sibling session, run:",
    "  bertrand log <category>/<slug>",
    "Returns a compact digest (~1-2KB per conversation): subject, Q&A decision trail, files touched, outcome.",
    "Reach for this when the user references work done in another session, or you need to verify what was decided or tried elsewhere.",
    "Escalate only if the digest isn't enough: --events for a filtered timeline, --full for the complete record.",
  ].join("\n");

  return `## Sibling Sessions\n${lines.join("\n")}\n${guidance}`;
}
