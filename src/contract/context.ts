import { getSessionsByGroup } from "@/db/queries/sessions";
import { formatAgo } from "@/lib/format";

/**
 * Build sibling sessions context layer.
 * Shows other sessions in the same group so the agent knows what's running nearby,
 * and tells it how to pull the full record for any of them via the CLI.
 */
export function buildSiblingContext(
  groupId: string,
  groupPath: string,
  currentSessionId: string
): string {
  const siblings = getSessionsByGroup(groupId).filter(
    (s) => s.id !== currentSessionId
  );

  if (siblings.length === 0) return "";

  const lines = siblings.map((s) => {
    const ago = s.updatedAt ? formatAgo(s.updatedAt) : "unknown";
    const summary = s.summary ? ` — "${s.summary}"` : "";
    return `- ${groupPath}/${s.slug}: ${s.status}${summary} (${ago})`;
  });

  const guidance = [
    "",
    "To inspect any sibling session's full record, run:",
    "  bertrand log <group>/<slug> --json",
    "Returns session metadata, stats, conversations, and the full event timeline.",
    "Reach for this when the user references work done in another session, or you need to verify what was decided or tried elsewhere.",
  ].join("\n");

  return `## Sibling Sessions\n${lines.join("\n")}\n${guidance}`;
}
