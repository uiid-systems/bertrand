import { spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

import type { StartupSelection } from "./screens/startup/startup.types";
import type { ExitAction } from "./screens/Exit";
import type { ResumeSelection } from "./screens/Resume";
import { deleteSession } from "@/db/queries/sessions";
import {
  getConversationsBySession,
  createConversation,
} from "@/db/queries/conversations";
import { archiveSession } from "@/lib/session-archive";
import { launch, resume } from "@/engine/session";
import {
  getActiveProjectSlug,
  listProjects,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { randomUUID } from "crypto";

// In source-tree dev, app.tsx lives at src/tui/ and run-screen.tsx is its
// sibling. After `bun run build`, both bundle into dist/ as .js files —
// detect the bundled artifact first and fall back to the source.
const SCREEN_ENTRY = (() => {
  const built = join(import.meta.dir, "run-screen.js");
  return existsSync(built) ? built : join(import.meta.dir, "run-screen.tsx");
})();

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
 * Render the unified pre-session flow (project picker → launch) and return
 * the user's final selection. Both pickers live in a single Storm app so
 * there's no alt-screen flash when transitioning between them.
 */
async function startStartupTui(
  skipProjectPicker: boolean,
  initialProjectSlug: string,
): Promise<StartupSelection> {
  return runScreen<StartupSelection>(
    "startup",
    String(skipProjectPicker),
    initialProjectSlug,
  );
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
      archiveSession(sessionId);
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
 * Skip the project picker when there's exactly one project AND the user
 * hasn't pinned a different one via `BERTRAND_PROJECT`. Hitting Enter on
 * a single-row picker is friction we'd be inflicting for no gain.
 */
function shouldShowProjectPicker(): boolean {
  if (process.env.BERTRAND_PROJECT) return false;
  const projects = listProjects();
  return projects.length !== 1;
}

/**
 * Main TUI entrypoint. Renders the unified startup flow (project picker
 * + launch), then runs the resulting session and shows the exit menu.
 */
export async function startTui(): Promise<void> {
  const skipProjectPicker = !shouldShowProjectPicker();
  const initialProjectSlug = getActiveProjectSlug();

  const selection = await startStartupTui(skipProjectPicker, initialProjectSlug);

  // The subprocess may have switched the active project. Reset the parent's
  // resolver cache so subsequent reads see the new active project.
  _resetActiveProjectCache();

  switch (selection.type) {
    case "quit":
      return;

    case "create": {
      const sessionId = await launch({
        categoryPath: selection.categoryPath,
        slug: selection.slug,
      });
      await runSessionLoop(sessionId);
      return;
    }

    case "pick": {
      const conversationId = await resolveConversationForResume(
        selection.sessionId,
      );
      if (!conversationId) return;
      const sessionId = await resume({
        sessionId: selection.sessionId,
        conversationId,
      });
      await runSessionLoop(sessionId);
      return;
    }
  }
}
