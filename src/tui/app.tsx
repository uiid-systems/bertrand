import { spawn } from "child_process";
import { readFileSync, unlinkSync } from "fs";
import { join } from "path";

import type { LaunchSelection } from "./screens/launch/launch.types";
import type { ExitAction } from "./screens/Exit";
import type { ResumeSelection } from "./screens/Resume";
import { updateSessionStatus, deleteSession } from "@/db/queries/sessions";
import {
  getConversationsBySession,
  createConversation,
} from "@/db/queries/conversations";
import { launch, resume } from "@/engine/session";
import { randomUUID } from "crypto";

const SCREEN_ENTRY = join(import.meta.dir, "run-screen.tsx");

/**
 * Run a TUI screen in a subprocess.
 *
 * Storm renders in the child process and exits completely when done.
 * The parent process never loads Storm — zero CPU overhead while Claude runs.
 */
async function runScreen<T>(screen: string, ...args: string[]): Promise<T> {
  const tmpFile = `/tmp/bertrand-tui-${process.pid}-${Date.now()}.json`;

  const child = spawn("bun", ["run", SCREEN_ENTRY, screen, tmpFile, ...args], {
    stdio: "inherit",
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`TUI screen "${screen}" exited with code ${exitCode}`);
  }

  const result = JSON.parse(readFileSync(tmpFile, "utf-8")) as T;
  unlinkSync(tmpFile);
  return result;
}

/**
 * Render the launch screen and return the user's selection.
 */
export async function startLaunchTui(): Promise<LaunchSelection> {
  return runScreen<LaunchSelection>("launch");
}

/**
 * Render the exit menu and return the user's chosen action.
 */
async function startExitTui(sessionId: string): Promise<ExitAction> {
  return runScreen<ExitAction>("exit", sessionId);
}

/**
 * Render the resume picker and return the user's choice.
 * Auto-selects if only one conversation exists.
 */
export async function startResumeTui(
  sessionId: string,
): Promise<ResumeSelection> {
  const conversations = getConversationsBySession(sessionId);

  if (conversations.length === 1) {
    return { type: "conversation", conversationId: conversations[0]!.id };
  }

  if (conversations.length === 0) {
    return { type: "new" };
  }

  return runScreen<ResumeSelection>("resume", sessionId);
}

/**
 * Resolve a conversation ID for resuming — either from the picker or a new one.
 */
async function resolveConversationForResume(
  sessionId: string,
): Promise<string | null> {
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
      if (!conversationId) break;
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
      const conversationId = await resolveConversationForResume(
        selection.sessionId,
      );
      if (!conversationId) break;
      const sessionId = await resume({
        sessionId: selection.sessionId,
        conversationId,
      });
      await runSessionLoop(sessionId);
      break;
    }
  }
}
