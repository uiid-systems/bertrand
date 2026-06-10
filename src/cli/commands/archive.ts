import { register } from "@/cli/router";
import { getSessionByGroupSlug } from "@/db/queries/sessions";
import { getGroupByPath } from "@/db/queries/groups";
import { parseSessionName } from "@/lib/parse-session-name";
import {
  archiveSession,
  unarchiveSession,
  archiveAllPaused,
} from "@/lib/session-archive";

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

  if (isAllPaused) {
    const { archived } = archiveAllPaused();
    if (archived.length === 0) {
      console.log("No paused sessions to archive.");
      return;
    }
    for (const { session, groupPath } of archived) {
      console.log(`  archived ${groupPath}/${session.slug}`);
    }
    console.log(
      `\nArchived ${archived.length} session${archived.length === 1 ? "" : "s"}.`
    );
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

  if (isUndo) {
    const result = unarchiveSession(session.id);
    if (!result.ok) {
      if (result.reason === "not-archived") {
        console.error(`${fullName} is not archived (status: ${session.status})`);
      } else {
        console.error(`Session not found: ${fullName}`);
      }
      process.exit(1);
    }
    console.log(`Unarchived ${fullName}`);
    return;
  }

  const result = archiveSession(session.id);
  if (!result.ok) {
    switch (result.reason) {
      case "active":
        console.error(
          `Cannot archive active session ${fullName} (status: ${session.status})`
        );
        break;
      case "already-archived":
        console.error(`${fullName} is already archived`);
        break;
      case "not-found":
        console.error(`Session not found: ${fullName}`);
        break;
    }
    process.exit(1);
  }
  console.log(`Archived ${fullName}`);
});
