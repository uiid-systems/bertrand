import { register } from "@/cli/router";
import {
  getAllSessions,
  getSessionByGroupSlug,
  updateSessionStatus,
} from "@/db/queries/sessions";
import { getGroupByPath } from "@/db/queries/groups";
import { parseSessionName } from "@/lib/parse-session-name";

const ACTIVE_STATUSES = ["working", "blocked", "prompting"] as const;

function resolveSession(name: string) {
  const { groupPath, slug } = parseSessionName(name);
  const group = getGroupByPath(groupPath);
  if (!group) {
    console.error(`Group not found: ${groupPath}`);
    process.exit(1);
  }
  const session = getSessionByGroupSlug(group.id, slug);
  if (!session) {
    console.error(`Session not found: ${name}`);
    process.exit(1);
  }
  return { session, groupPath };
}

register("archive", async (args) => {
  const isUndo = args.includes("--undo");
  const isAllPaused = args.includes("--all-paused");
  const filteredArgs = args.filter((a) => !a.startsWith("--"));
  const sessionName = filteredArgs[0];

  // --all-paused: batch archive all paused sessions
  if (isAllPaused) {
    const rows = getAllSessions({ excludeArchived: true });
    const paused = rows.filter((r) => r.session.status === "paused");

    if (paused.length === 0) {
      console.log("No paused sessions to archive.");
      return;
    }

    let archived = 0;
    for (const row of paused) {
      updateSessionStatus(row.session.id, "archived");
      console.log(`  archived ${row.groupPath}/${row.session.slug}`);
      archived++;
    }
    console.log(`\nArchived ${archived} session${archived === 1 ? "" : "s"}.`);
    return;
  }

  if (!sessionName) {
    console.error("Usage: bertrand archive <session>");
    console.error("       bertrand archive --undo <session>");
    console.error("       bertrand archive --all-paused");
    process.exit(1);
  }

  const { session, groupPath } = resolveSession(sessionName);
  const fullName = `${groupPath}/${session.slug}`;

  // --undo: unarchive
  if (isUndo) {
    if (session.status !== "archived") {
      console.error(`${fullName} is not archived (status: ${session.status})`);
      process.exit(1);
    }
    updateSessionStatus(session.id, "paused");
    console.log(`Unarchived ${fullName}`);
    return;
  }

  // Archive
  if ((ACTIVE_STATUSES as readonly string[]).includes(session.status)) {
    console.error(`Cannot archive active session ${fullName} (status: ${session.status})`);
    process.exit(1);
  }
  if (session.status === "archived") {
    console.error(`${fullName} is already archived`);
    process.exit(1);
  }

  updateSessionStatus(session.id, "archived");
  console.log(`Archived ${fullName}`);
});
