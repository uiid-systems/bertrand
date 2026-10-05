import { getAllSessions, getSession, setSessionSummary } from "@/db/queries/sessions";
import type { SessionRow } from "@/types";
import { deriveSessionSummary } from "@/lib/summary";
import { isMachinePrompt } from "@/lib/machine-prompt";
import { formatAgo } from "@/lib/format";

/**
 * Sibling sessions context layer, injected into every session's contract.
 *
 * Scoped to the current session's repo (docs/context-budget.md). The block is
 * paid for in tokens on every conversation, and a global most-recent list
 * spent all of it on other repos' work: a bertrand session was handed twelve
 * tabs-backend and backgammon siblings and none of its own. So:
 *
 *   - same repo only, the same branch (`groupKey`) ranked first;
 *   - a session outside git matches on its `groupKey` (the worktree path);
 *   - a session with no key at all can't be judged for relevance, so it keeps
 *     the old global list — degrade to the previous behaviour, not to silence.
 *
 * Other repos stay one `bertrand list` away. Summaries come from the
 * pause-time derivation in lib/summary.ts. Archived sessions are excluded;
 * they stay discoverable via `bertrand list --all`.
 */

const MAX_SIBLINGS = 5;

export function buildSiblingContext(currentSessionId: string): string {
  const all = getAllSessions({ excludeArchived: true });
  // Looked up directly, not from `all`: an archived current session (resumed
  // from `bertrand list --all`) is still scoped by its repo, never the global list.
  const self = getSession(currentSessionId);
  const sameBranch = (s: SessionRow) =>
    !!self?.groupKey && s.groupKey === self.groupKey;
  const related = (s: SessionRow) =>
    self?.repo ? s.repo === self.repo : self?.groupKey ? sameBranch(s) : true;

  const rows = all
    .filter((r) => r.session.id !== currentSessionId && related(r.session))
    .sort(
      (a, b) =>
        Number(sameBranch(b.session)) - Number(sameBranch(a.session)) ||
        new Date(b.session.updatedAt).getTime() -
          new Date(a.session.updatedAt).getTime(),
    );

  if (rows.length === 0) return "";

  const shown = rows.slice(0, MAX_SIBLINGS);
  const lines = shown.map(({ session: s }) => {
    const ago = s.updatedAt ? formatAgo(s.updatedAt) : "unknown";
    // Lazy backfill: sessions paused before the pause-time derivation existed
    // have a NULL summary, and ones derived before machine prompts were
    // skipped lead with raw `<task-notification>` XML — heal both the first
    // time they render as siblings.
    // Guarded: this runs on the session-launch path, and a SQLITE_BUSY from a
    // neighbor's metadata upkeep must never prevent this session's start.
    let summaryText = s.summary;
    if (!summaryText || isMachinePrompt(summaryText)) {
      try {
        summaryText = deriveSessionSummary(s.id);
        if (summaryText) setSessionSummary(s.id, summaryText);
      } catch {
        summaryText = null;
      }
    }
    const summary = summaryText ? ` — "${summaryText}"` : "";
    return `- ${s.slug}: ${s.status}${summary} (${ago})`;
  });

  if (rows.length > shown.length) {
    lines.push(`- …plus ${rows.length - shown.length} more — run \`bertrand list\``);
  }

  const scope = self?.repo ?? (self?.groupKey ? "this directory" : null);
  const heading = scope ? `## Sibling Sessions (${scope})` : "## Sibling Sessions";
  return `${heading}\n${lines.join("\n")}\nInspect one with \`bertrand log <session>\`.`;
}
