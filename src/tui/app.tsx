import { render } from "@orchetron/storm";
import { Launch, type LaunchSelection } from "./screens/Launch.tsx";
import { Exit, type ExitAction } from "./screens/Exit.tsx";
import { updateSessionStatus } from "../db/queries/sessions.ts";
import { getConversationsBySession, createConversation } from "../db/queries/conversations.ts";
import { launch, resume } from "../engine/session.ts";
import { randomUUID } from "crypto";

/**
 * Render the launch screen and return the user's selection.
 */
export async function startLaunchTui(): Promise<LaunchSelection> {
  let result: LaunchSelection = { type: "quit" };

  const app = render(
    <Launch onSelect={(selection) => { result = selection; }} />,
    { alternateScreen: true, patchConsole: true },
  );
  await app.waitUntilExit();

  return result;
}

/**
 * Render the exit menu and return the user's chosen action.
 */
async function startExitTui(sessionId: string): Promise<ExitAction> {
  let result: ExitAction = "save";

  const app = render(
    <Exit sessionId={sessionId} onAction={(action) => { result = action; }} />,
    { alternateScreen: true, patchConsole: true },
  );
  await app.waitUntilExit();

  return result;
}

/**
 * Full session loop: launch/resume Claude, show exit menu, handle action.
 * Loops if the user chooses "resume" from the exit menu.
 */
export async function runSessionLoop(sessionId: string): Promise<void> {
  const action = await startExitTui(sessionId);

  switch (action) {
    case "save":
      // Already paused — done
      break;

    case "archive":
      updateSessionStatus(sessionId, "archived");
      break;

    case "discard": {
      const { getDb } = await import("../db/client.ts");
      const { sessions } = await import("../db/schema.ts");
      const { eq } = await import("drizzle-orm");
      getDb().delete(sessions).where(eq(sessions.id, sessionId)).run();
      break;
    }

    case "resume": {
      const conversations = getConversationsBySession(sessionId);
      let conversationId: string;
      if (conversations.length > 0) {
        conversationId = conversations[0]!.id;
      } else {
        conversationId = randomUUID();
        createConversation({ id: conversationId, sessionId });
      }
      await resume({ sessionId, conversationId });
      // Show exit menu again after Claude finishes
      await runSessionLoop(sessionId);
      break;
    }
  }
}

/**
 * Main TUI entrypoint. Shows launch screen, runs session, shows exit menu.
 */
export async function startTui(): Promise<void> {
  const selection = await startLaunchTui();

  switch (selection.type) {
    case "quit":
      break;

    case "create": {
      const sessionId = await launch(selection);
      await runSessionLoop(sessionId);
      break;
    }

    case "resume": {
      const sessionId = await resume(selection);
      await runSessionLoop(sessionId);
      break;
    }
  }
}
