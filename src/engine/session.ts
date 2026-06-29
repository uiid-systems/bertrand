import { randomUUID } from "crypto";
import {
  createSession,
  updateSession,
  getSession,
  getSessionByCategorySlug,
} from "@/db/queries/sessions";
import {
  createConversation,
  endConversation,
  getConversation,
} from "@/db/queries/conversations";
import {
  emitClaudeEnded,
  emitClaudeStarted,
} from "@/db/events/emit";
import { getOrCreateCategoryPath, getCategory, getCategoryByPath } from "@/db/queries/categories";
import {
  addLabelToSession,
  getOrCreateLabelByName,
} from "@/db/queries/labels";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { helpText } from "@/cli/help";
import { launchClaude, isClaudeRunning } from "./process";
import { computeAndPersist } from "@/lib/timing";
import { ensureServerStarted, stopServerIfIdle } from "@/lib/server-lifecycle";
import { triggerBackgroundPush } from "@/sync/trigger";
import { claudeSessionExists } from "@/lib/transcript";
import {
  pruneSessionMarkers,
  pruneStaleContractMarkers,
} from "@/hooks/runtime";

// Tracks the session currently owned by this bertrand process. Set when
// the row flips to "active" and cleared by finalizeSession on the happy
// path. The exit handler below uses it to force the row out of "active"
// if bertrand dies before finalizeSession runs (second Ctrl+C, SIGHUP
// from terminal close, uncaught exception, etc.) — without this safety
// net the row stays "active" until the next launch triggers
// recoverStaleSessions, which is the user-visible "hangs until a new
// session begins" symptom.
let liveSession: { sessionId: string; claudeId: string } | null = null;
let exitHandlersInstalled = false;

function forceFinalizeLive(): void {
  if (!liveSession) return;
  const session = getSession(liveSession.sessionId);
  if (!session) {
    liveSession = null;
    return;
  }
  if (session.status !== "active" && session.status !== "waiting") {
    liveSession = null;
    return;
  }
  try {
    updateSession(liveSession.sessionId, {
      status: "paused",
      pid: null,
      endedAt: new Date().toISOString(),
    });
  } catch {
    // Best-effort — bertrand is on its way out.
  }
  liveSession = null;
}

/** Test-only seams. Mirrors the _setDb / _setTestDeps pattern elsewhere. */
export function _setLiveSession(
  next: { sessionId: string; claudeId: string } | null,
): void {
  liveSession = next;
}
export function _forceFinalizeLive(): void {
  forceFinalizeLive();
}
/** Test-only: invoke installExitHandlers and reset its guard so successive
 *  test runs can observe the listener-registration behavior independently. */
export function _installExitHandlersForTest(): void {
  exitHandlersInstalled = false;
  installExitHandlers();
}
export function _resetExitHandlersForTest(): void {
  exitHandlersInstalled = false;
}

function installExitHandlers(): void {
  if (exitHandlersInstalled) return;
  exitHandlersInstalled = true;

  // Synchronous last-line-of-defense. drizzle + bun:sqlite are synchronous,
  // so the DB write completes before the process actually exits.
  process.on("exit", forceFinalizeLive);

  // SIGHUP is the only signal Node's default behavior leaves to us — the
  // terminal closes and the process is killed without firing "exit". Catch
  // it so forceFinalizeLive runs. SIGINT/SIGTERM are deliberately NOT
  // installed here: the foreground subprocess (launchClaude during a Claude
  // session, runScreen during a TUI screen) owns the terminal and registers
  // its own forwarder; a parent-level handler would race the child and
  // either prematurely terminate the parent (orphaning the child + leaving
  // alt-screen on) or fight the child's signal handling.
  const onSignal = (signal: NodeJS.Signals): void => {
    if (isClaudeRunning()) return;
    process.exit(signal === "SIGHUP" ? 129 : 143);
  };
  process.on("SIGHUP", onSignal);
}

export interface LaunchOpts {
  /** Category path, e.g. "uiid/bertrand" */
  categoryPath: string;
  /** Session slug, e.g. "fix-auth-bug" */
  slug: string;
  /** Display name (defaults to slug) */
  name?: string;
  /** Label names to attach. Created if they don't exist. */
  labelNames?: string[];
}

export interface ResumeOpts {
  sessionId: string;
  conversationId: string;
}

/**
 * Create a new session and launch Claude.
 * Returns session ID when the Claude process exits.
 */
export async function launch(opts: LaunchOpts): Promise<string> {
  // Sweep orphaned contract-sent markers left by sessions bertrand never
  // finalized (background jobs, the Warp launcher) before they accumulate.
  pruneStaleContractMarkers();

  // Check for duplicate session slug within the target category
  const existingCategory = getCategoryByPath(opts.categoryPath);
  if (existingCategory) {
    const existing = getSessionByCategorySlug(existingCategory.id, opts.slug);
    if (existing) {
      throw new Error(
        `Session "${opts.slug}" already exists in category "${opts.categoryPath}"`
      );
    }
  }

  const categoryId = getOrCreateCategoryPath(opts.categoryPath);
  const session = createSession({
    categoryId,
    slug: opts.slug,
    name: opts.name ?? opts.slug,
  });

  for (const name of opts.labelNames ?? []) {
    const label = getOrCreateLabelByName(name);
    addLabelToSession(session.id, label.id);
  }

  const claudeId = randomUUID();
  const conversation = createConversation({
    id: claudeId,
    sessionId: session.id,
  });

  // Update session to working with PID
  updateSession(session.id, { status: "active", pid: process.pid });
  liveSession = { sessionId: session.id, claudeId };
  installExitHandlers();
  await ensureServerStarted();

  const sessionName = `${opts.categoryPath}/${opts.slug}`;

  emitClaudeStarted({
    sessionId: session.id,
    conversationId: claudeId,
    cwd: process.cwd(),
  });

  // Build contract with context
  const siblingContext = buildSiblingContext(categoryId, opts.categoryPath, session.id);
  const contract = buildContract(sessionName, helpText({ agent: true }), siblingContext);

  // Launch Claude
  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId,
    sessionName,
    sessionSlug: opts.slug,
    contract,
  });

  finalizeSession(session.id, claudeId, exitCode);
  return session.id;
}

/**
 * Resume an existing session with a specific conversation.
 * Returns session ID when the Claude process exits.
 */
export async function resume(opts: ResumeOpts): Promise<string> {
  pruneStaleContractMarkers();

  const session = getSession(opts.sessionId);
  if (!session) throw new Error(`Session not found: ${opts.sessionId}`);

  const category = getCategory(session.categoryId);
  const sessionName = category ? `${category.path}/${session.slug}` : session.name;

  // `claude --resume <id>` only works when Claude has a transcript JSONL
  // at the current CWD. Two cases break it: (1) the resume picker's
  // "+ New conversation" mints a UUID Claude has never seen, (2) the
  // bertrand session existed but the user exited Claude before any
  // message was persisted. Both manifest as "No conversation found with
  // session ID: <uuid>" and drop straight to the exit screen. Fall back
  // to `--session-id` — Claude treats it as a fresh session under the
  // same UUID, so bertrand events keep their conversation_id linkage.
  const isFreshClaudeSession = !claudeSessionExists(opts.conversationId);

  updateSession(session.id, { status: "active", pid: process.pid });
  liveSession = { sessionId: session.id, claudeId: opts.conversationId };
  installExitHandlers();
  await ensureServerStarted();

  if (isFreshClaudeSession) {
    emitClaudeStarted({
      sessionId: session.id,
      conversationId: opts.conversationId,
      cwd: process.cwd(),
    });
  }

  // Build contract
  const categoryPath = category?.path ?? "";
  const siblingContext = buildSiblingContext(session.categoryId, categoryPath, session.id);
  const contract = buildContract(sessionName, helpText({ agent: true }), siblingContext);

  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId: opts.conversationId,
    sessionName,
    sessionSlug: session.slug,
    contract,
    resume: !isFreshClaudeSession,
  });

  finalizeSession(session.id, opts.conversationId, exitCode);
  return session.id;
}

/**
 * Run end-of-Claude cleanup defensively. If the session or conversation row
 * was deleted while Claude was running (parallel bertrand instance, manual
 * delete, etc.), skip the writes that would violate FK constraints rather
 * than crashing the post-Claude TUI flow.
 */
function finalizeSession(
  sessionId: string,
  conversationId: string,
  exitCode: number
): void {
  if (!getSession(sessionId)) return;

  const conversationExists = !!getConversation(conversationId);
  const safeConversationId = conversationExists ? conversationId : undefined;

  if (conversationExists) {
    endConversation(conversationId);
  }

  emitClaudeEnded({
    sessionId,
    conversationId: safeConversationId,
    exitCode,
  });

  updateSession(sessionId, {
    status: "paused",
    pid: null,
    endedAt: new Date().toISOString(),
  });

  if (liveSession?.sessionId === sessionId) liveSession = null;

  pruneSessionMarkers(sessionId, safeConversationId);

  computeAndPersist(sessionId);
  stopServerIfIdle();

  // Sync push on session end. Detached fire-and-forget — won't block exit.
  triggerBackgroundPush();
}
