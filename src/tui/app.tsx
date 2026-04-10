import { render } from "@orchetron/storm";
import { Launch, type LaunchSelection } from "./screens/Launch.tsx";
import { Exit, type ExitAction } from "./screens/Exit.tsx";
import { Resume, type ResumeSelection } from "./screens/Resume.tsx";
import { updateSessionStatus, deleteSession } from "../db/queries/sessions.ts";
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
 * Render the resume picker and return the user's choice.
 * Auto-selects if only one conversation exists.
 */
export async function startResumeTui(sessionId: string): Promise<ResumeSelection> {
  const conversations = getConversationsBySession(sessionId);

  // Auto-select if single conversation
  if (conversations.length === 1) {
    return { type: "conversation", conversationId: conversations[0]!.id };
  }

  // No conversations — go straight to new
  if (conversations.length === 0) {
    return { type: "new" };
  }

  let result: ResumeSelection = { type: "back" };

  const app = render(
    <Resume sessionId={sessionId} onSelect={(selection) => { result = selection; }} />,
    { alternateScreen: true, patchConsole: true },
  );
  await app.waitUntilExit();

  return result;
}

/**
 * Resolve a conversation ID for resuming — either from the picker or a new one.
 */
async function resolveConversationForResume(sessionId: string): Promise<string | null> {
  const selection = await startResumeTui(sessionId);

  switch (selection.type) {
    case "conversation":
      return selection.conversationId;
    case "new": {
      const id = randomUUID();
      createConversation({ id, sessionId });
      return id;
    }
    case "back":
      return null;
  }
}

/**
 * Post-session loop: show exit menu, handle action.
 * Loops if the user chooses "resume" from the exit menu.
 */
export async function runSessionLoop(sessionId: string): Promise<void> {
  const action = await startExitTui(sessionId);

  switch (action) {
    case "save":
      break;

    case "archive":
      updateSessionStatus(sessionId, "archived");
      break;

    case "discard":
      deleteSession(sessionId);
      break;

    case "resume": {
      const conversationId = await resolveConversationForResume(sessionId);
      if (!conversationId) break; // user pressed back
      await resume({ sessionId, conversationId });
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

    case "pick": {
      const conversationId = await resolveConversationForResume(selection.sessionId);
      if (!conversationId) break; // user pressed back
      const sessionId = await resume({ sessionId: selection.sessionId, conversationId });
      await runSessionLoop(sessionId);
      break;
    }
  }
}
