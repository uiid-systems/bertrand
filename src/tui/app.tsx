import { spawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import type { LaunchSelection } from "./screens/launch/launch.types";
import type { ExitAction } from "./screens/Exit";
import type { ResumeSelection } from "./screens/Resume";
import type { ProjectPickerSelection } from "./screens/project-picker/project-picker.types";
import { deleteSession } from "@/db/queries/sessions";
import {
  getConversationsBySession,
  createConversation,
} from "@/db/queries/conversations";
import { archiveSession } from "@/lib/session-archive";
import { launch, resume } from "@/engine/session";
import {
  setActiveProjectSlug,
  listProjects,
} from "@/lib/projects/registry";
import { createProject } from "@/lib/projects/create";
import {
  _resetActiveProjectCache,
  resolveActiveProject,
} from "@/lib/projects/resolve";

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

  // Pin the active project for the screen subprocess. resolveActiveProject()
  // is memoized in this parent to whatever was active when the session was
  // launched, so it survives `project switch` (or a concurrent session in
  // another project) mutating the global `activeProjectSlug` in projects.json.
  // Without this, the spawned screen re-resolves the project from that mutable
  // global and the Exit/Resume screens' getSession() lookups hit the wrong
  // per-project DB — surfacing "Session not found" instead of the exit menu.
  const child = spawn("bun", ["run", SCREEN_ENTRY, screen, tmpFile, ...args], {
    stdio: "inherit",
    env: { ...process.env, BERTRAND_PROJECT: resolveActiveProject().slug },
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
 * Render the project picker and return the user's selection. Skipped
 * when only one project is registered AND no env-var override is set —
 * the picker would be one row to confirm with Enter, which is friction
 * we don't need.
 */
export async function startProjectPickerTui(): Promise<ProjectPickerSelection> {
  return runScreen<ProjectPickerSelection>("project-picker");
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
 * Activate the project the user selected (or just created) so the
 * launch screen that follows sees its sessions, not whoever was active
 * before. The resolver cache is per-process so we explicitly reset.
 */
function activateProject(slug: string): void {
  setActiveProjectSlug(slug);
  _resetActiveProjectCache();
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
 * Main TUI entrypoint. Shows project picker (when more than one project
 * exists), then launch screen, runs session, shows exit menu.
 */
export async function startTui(): Promise<void> {
  if (!shouldShowProjectPicker()) {
    await runLaunchCycle();
    return;
  }

  const projectSelection = await startProjectPickerTui();
  switch (projectSelection.type) {
    case "quit":
      return;

    case "select": {
      activateProject(projectSelection.slug);
      await runLaunchCycle();
      return;
    }

    case "create": {
      createProject({ slug: projectSelection.slug });
      activateProject(projectSelection.slug);
      await runLaunchCycle();
      return;
    }
  }
}
