import { spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import type { LaunchSelection } from "./screens/launch/launch.types";
import type { ExitAction } from "./screens/Exit";
import type { ResumeSelection } from "./screens/Resume";
import { deleteSession } from "@/db/queries/sessions";
import {
  getConversationsBySession,
  createConversation,
} from "@/db/queries/conversations";
import { archiveSession } from "@/lib/session-archive";
import { launch, resume } from "@/engine/session";

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
 *
 * Signal handling: while the child is alive we install no-op SIGINT/SIGTERM
 * handlers on the parent. The TTY delivers signals to the foreground process
 * group, so the child gets them and handles its own cleanup. The parent
 * handler exists purely to suppress Node's default-terminate-on-signal
 * behavior; without it, a Ctrl+C during the exit screen would kill the
 * parent before it could read the child's result file. run-screen.tsx is
 * responsible for ensuring a result file is always written, even on signal.
 */
async function runScreen<T>(screen: string, ...args: string[]): Promise<T> {
  const tmpFile = join(tmpdir(), `bertrand-tui-${randomUUID()}.json`);

  // BERTRAND_DEBUG_TUI instrumentation — parent-side breadcrumb so we can
  // tell from the log file whether the env var actually reached us.
  if (process.env.BERTRAND_DEBUG_TUI) {
    try {
      const { appendFileSync } = await import("fs");
      appendFileSync(
        process.env.BERTRAND_DEBUG_TUI,
        `--- parent runScreen("${screen}") at ${Date.now()} entry=${SCREEN_ENTRY}\n`,
      );
    } catch {
      // best-effort
    }
  }

  // The child inherits this process's environment untouched. It used to be
  // handed a `BERTRAND_PROJECT` pin, because a screen subprocess re-resolved
  // the active project from a mutable global in projects.json and could open a
  // *different* project's DB than its parent — surfacing "Session not found"
  // instead of the exit menu. There is one DB now, so there is nothing left to
  // pin: every screen opens the same file its parent did.
  const child = spawn("bun", ["run", SCREEN_ENTRY, screen, tmpFile, ...args], {
    stdio: "inherit",
    env: { ...process.env },
  });

  const noopSignal = (): void => {};
  process.on("SIGINT", noopSignal);
  process.on("SIGTERM", noopSignal);

  let spawnError: Error | null = null;

  try {
    const { code, signal } = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on("error", (err) => {
        spawnError = err;
        resolve({ code: 1, signal: null });
      });
      child.on("exit", (c, s) => resolve({ code: c, signal: s }));
    });

    if (spawnError) {
      throw new Error(
        `Failed to launch TUI screen "${screen}": ${(spawnError as Error).message}`,
      );
    }

    if (!existsSync(tmpFile)) {
      // Child died before run-screen.tsx's try/finally wrote the result.
      // Surface a specific message instead of throwing on the JSON.parse.
      const detail = signal
        ? `killed by ${signal}`
        : `exited with code ${code ?? "?"} without writing result`;
      throw new Error(`TUI screen "${screen}" ${detail}`);
    }

    return JSON.parse(readFileSync(tmpFile, "utf-8")) as T;
  } finally {
    process.removeListener("SIGINT", noopSignal);
    process.removeListener("SIGTERM", noopSignal);
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // best-effort
    }
  }
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
 *
 * Always shows the picker when at least one conversation exists — the
 * Exit screen's "Resume" option promises a choice between continuing an
 * existing conversation and starting a new one, so silently auto-
 * selecting the lone conversation when there's only one makes that
 * promise lie. The only exception is zero conversations, where there's
 * nothing to pick and auto-new is the only sensible path.
 */
export async function startResumeTui(
  sessionId: string,
): Promise<ResumeSelection> {
  const conversations = getConversationsBySession(sessionId);

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
 * One launch cycle: TUI launch screen → session → exit menu.
 */
async function runLaunchCycle(): Promise<void> {
  const selection = await startLaunchTui();

  switch (selection.type) {
    case "quit":
      return;

    case "create": {
      const sessionId = await launch(selection);
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

/**
 * Main TUI entrypoint: launch screen, run the session, show the exit menu.
 *
 * There is no longer a screen before this one. A project picker used to gate
 * the launch screen, because the sessions it listed came from whichever
 * project's DB was active and picking the wrong one showed you the wrong
 * sessions. Grouping is derived from each session's cwd now and every session
 * lives in one DB, so the launch screen can show all of them at once, rolled up
 * by repo — which is the answer the picker was a slow, error-prone way of
 * asking for.
 */
export async function startTui(): Promise<void> {
  await runLaunchCycle();
}
