import { randomUUID } from "crypto";
import {
  createSession,
  updateSession,
  getSession,
  getSessionBySlug,
  untakenPlaceholderSlug,
} from "@/db/queries/sessions";
import { getSessionByAlias } from "@/db/queries/session-aliases";
import { createConversation } from "@/db/queries/conversations";
import { emitClaudeStarted } from "@/db/events/emit";
import { recordSessionBranch } from "@/lib/session-branch";
import {
  addLabelToSession,
  getOrCreateLabelByName,
} from "@/db/queries/labels";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { helpText } from "@/cli/help";
import { launchClaude, isClaudeRunning } from "./process";
import { finalizeSessionRow } from "@/lib/session-finalize";
import { ensureServerStarted } from "@/lib/server-lifecycle";
import { planResume } from "./resume-plan";
import { pruneStaleMarkers } from "@/hooks/runtime";
import { formatDbTime } from "@/lib/format";

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
      pidStartedAt: null,
      // The `datetime('now')` shape `startedAt` uses — the two are subtracted
      // for a session's duration, and mixing shapes skews it (see finalize).
      endedAt: formatDbTime(Date.now()),
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
  /**
   * Session slug, e.g. "fix-auth-bug" — the session's whole identity.
   * Omitted means the caller has nothing to name it with yet: the session
   * starts on a placeholder and pause-time derivation names it for real
   * (name_source='derived').
   */
  slug?: string;
  /**
   * Display name (defaults to slug). Requires `slug`: pause-time derivation
   * sets name and slug together, so a display name on an unnamed session
   * would be silently overwritten at the first pause.
   */
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
  // Sweep orphaned contract-sent and adoption markers left by sessions
  // bertrand never finalized (background jobs, an external launcher) before
  // they accumulate.
  pruneStaleMarkers();

  const slug = opts.slug ?? untakenPlaceholderSlug();

  // Friendly duplicate check ahead of the unique index — the index still
  // backstops a race, but this is the message users see. A retired name is
  // refused too: the unique index wouldn't stop it, and taking a name an alias
  // points at would silently strand the session that alias belongs to.
  if (opts.slug) {
    if (getSessionBySlug(opts.slug)) {
      throw new Error(`Session "${opts.slug}" already exists`);
    }
    const aliased = getSessionByAlias(opts.slug);
    if (aliased) {
      throw new Error(
        `"${opts.slug}" is a former name of session "${aliased.slug}" — pick another name.`,
      );
    }
  }

  const session = createSession({
    slug,
    name: opts.name,
    nameSource: opts.slug ? undefined : "derived",
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
  updateSession(session.id, {
    status: "active",
    pid: process.pid,
    pidStartedAt: Date.now(),
  });
  liveSession = { sessionId: session.id, claudeId };
  installExitHandlers();
  await ensureServerStarted();

  const sessionName = slug;

  // Recorded on every start, not only the first: the column is current state.
  await recordSessionBranch(session.id, process.cwd());

  emitClaudeStarted({
    sessionId: session.id,
    conversationId: claudeId,
    cwd: process.cwd(),
  });

  // Build contract with context
  const siblingContext = buildSiblingContext(session.id);
  const contract = buildContract(sessionName, helpText({ agent: true }), siblingContext);

  // Launch Claude
  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId,
    sessionName,
    sessionSlug: slug,
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
  pruneStaleMarkers();

  // Shared with the server-hosted path so the two can't drift on which
  // conversation to attach to or whether Claude has ever seen it. A CLI process
  // runs in the session's own directory, so `process.cwd()` is the right place
  // to look for the transcript here.
  const planned = planResume({
    sessionId: opts.sessionId,
    conversationId: opts.conversationId,
    cwd: process.cwd(),
  });
  if (!planned.ok) {
    throw new Error(
      planned.reason === "not-found"
        ? `Session not found: ${opts.sessionId}`
        : `Conversation ${opts.conversationId} does not belong to session ${opts.sessionId}`,
    );
  }
  const { session, sessionName, contract, resumeExisting } = planned.plan;

  updateSession(session.id, {
    status: "active",
    pid: process.pid,
    pidStartedAt: Date.now(),
  });
  liveSession = { sessionId: session.id, claudeId: opts.conversationId };
  installExitHandlers();
  await ensureServerStarted();

  // Outside the resume guard on purpose. The event must not be re-emitted for
  // a continuing conversation, but the branch must be re-read: a session can
  // resume on a different branch than it left.
  await recordSessionBranch(session.id, process.cwd());

  if (!resumeExisting) {
    emitClaudeStarted({
      sessionId: session.id,
      conversationId: opts.conversationId,
      cwd: process.cwd(),
    });
  }

  const exitCode = await launchClaude({
    sessionId: session.id,
    claudeId: opts.conversationId,
    sessionName,
    sessionSlug: session.slug,
    contract,
    resume: resumeExisting,
  });

  finalizeSession(session.id, opts.conversationId, exitCode);
  return session.id;
}

/**
 * Run end-of-Claude cleanup for a CLI-hosted session. The shared work lives in
 * finalizeSessionRow so the server-hosted path (dashboard-session.ts) cannot
 * drift from it; only the liveSession bookkeeping below is specific to owning
 * a session in this process.
 */
function finalizeSession(
  sessionId: string,
  conversationId: string,
  exitCode: number
): void {
  if (liveSession?.sessionId === sessionId) liveSession = null;

  // A CLI process owns no other session, so it may stop an idle server.
  finalizeSessionRow(sessionId, conversationId, exitCode, { stopServerWhenIdle: true });
}
