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
  emitSessionEnded,
  emitSessionResumed,
  emitSessionStarted,
} from "@/db/events/emit";
import { getOrCreateCategoryPath, getCategory, getCategoryByPath } from "@/db/queries/categories";
import {
  addLabelToSession,
  getOrCreateLabelByName,
} from "@/db/queries/labels";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { launchClaude, isClaudeRunning } from "./process";
import { captureSpawnContext } from "./spawn-context";
import { computeAndPersist } from "@/lib/timing";
import { ensureServerStarted, stopServerIfIdle } from "@/lib/server-lifecycle";

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

  // Capture spawn context (model, claude version, git, cwd) in parallel before
  // logging start events so the frozen-in-time meta on session.started /
  // claude.started reflects what was true at launch.
  const spawnContext = await captureSpawnContext();
  const sessionName = `${opts.categoryPath}/${opts.slug}`;

  emitSessionStarted({
    sessionId: session.id,
    conversationId: claudeId,
    categoryPath: opts.categoryPath,
    sessionName: opts.name ?? opts.slug,
    sessionSlug: opts.slug,
    labels: opts.labelNames ?? [],
    summary: session.summary ?? null,
  });
  emitClaudeStarted({
    sessionId: session.id,
    conversationId: claudeId,
    model: spawnContext.model,
    claudeVersion: spawnContext.claudeVersion,
    git: spawnContext.git,
    cwd: spawnContext.cwd,
    // worktree: spawnContext.worktree, // STUB — wired when worktree support lands
  });

  // Build contract with context
  const siblingContext = buildSiblingContext(categoryId, opts.categoryPath, session.id);
  const contract = buildContract(sessionName, siblingContext);

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
  const session = getSession(opts.sessionId);
  if (!session) throw new Error(`Session not found: ${opts.sessionId}`);

  const category = getCategory(session.categoryId);
  const sessionName = category ? `${category.path}/${session.slug}` : session.name;
  updateSession(session.id, { status: "active", pid: process.pid });
  liveSession = { sessionId: session.id, claudeId: opts.conversationId };
  installExitHandlers();
  await ensureServerStarted();

  emitSessionResumed({
    sessionId: session.id,
    conversationId: opts.conversationId,
  });

  // Build contract
  const categoryPath = category?.path ?? "";
  const siblingContext = buildSiblingContext(session.categoryId, categoryPath, session.id);
  const contract = buildContract(sessionName, siblingContext);

  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId: opts.conversationId,
    sessionName,
    sessionSlug: session.slug,
    contract,
    resume: true,
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

  emitSessionEnded({ sessionId });

  computeAndPersist(sessionId);
  stopServerIfIdle();
}
