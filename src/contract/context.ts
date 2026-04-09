import { getSessionsByGroup } from "../db/queries/sessions.ts";
import { formatAgo } from "../lib/format.ts";

/**
 * Build sibling sessions context layer.
 * Shows other sessions in the same group so the agent knows what's running nearby.
 */
export function buildSiblingContext(
  groupId: string,
  currentSessionId: string
): string {
  const siblings = getSessionsByGroup(groupId).filter(
    (s) => s.id !== currentSessionId
  );

  if (siblings.length === 0) return "";

  const lines = siblings.map((s) => {
    const ago = s.updatedAt ? formatAgo(s.updatedAt) : "unknown";
    const summary = s.summary ? ` — "${s.summary}"` : "";
    return `- ${s.slug}: ${s.status}${summary} (${ago})`;
  });

  return `## Sibling Sessions\n${lines.join("\n")}`;
}
