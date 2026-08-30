import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { createSession, updateSession, getSession } from "@/db/queries/sessions";
import { getEdgeEventOfType } from "@/db/queries/events";
import { planResume } from "./resume-plan";
import { createConversation } from "@/db/queries/conversations";
import { emitClaudeStarted } from "@/db/events/emit";
import { recordSessionBranch } from "@/lib/session-branch";
import { getOrCreateCategoryPath } from "@/db/queries/categories";
import { finalizeSessionRow } from "./finalize";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { requireBoundRepo } from "@/lib/projects/policy";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { helpText } from "@/cli/help";
import { smallestDims, spawnPty, type PtyDims, type PtyHandle } from "./pty";
import { connectTerminalRelay, type TerminalRelayClient } from "./terminal-relay-client";

/**
 * Sessions whose PTY is owned by `bertrand serve` rather than by a CLI process
 * — see docs/pty-wrapper.md and issue #207. The browser is the only viewer, so
 * there is no local terminal to take a geometry minimum against and the
 * browser's claim is honored outright.
 *
 * Deliberately a map rather than the module-level singletons launchClaude uses
 * (`activePty`, `liveSession`): the server hosts many sessions at once, so all
 * per-session state has to be keyed by session ID.
 */
interface DashboardSession {
  sessionId: string;
  claudeId: string;
  pty: PtyHandle;
  relay: TerminalRelayClient | null;
  /** Geometry browsers are asking for; the only sizing input this path has. */
  claim: PtyDims | null;
}

const sessions = new Map<string, DashboardSession>();

/**
 * Ceiling on concurrently running dashboard-owned sessions (#209).
 *
 * A server-spawned session is not cheap: a full `claude` process plus the MCP
 * servers it starts, all of them outliving the browser tab that asked for one.
 * Nothing about the HTTP endpoint is self-limiting, so without a cap a stuck
 * client (or a retry loop) can fork the machine to its knees.
 *
 * The number is a machine-protection guess, not a licensing rule — override it
 * when you know your box can take more.
 *
 * Read per call rather than snapshotted at module load. Both hosting entry
 * points consult it, and a module-level constant made the bound a function of
 * *import order* — two test files needing different caps in one process would
 * silently get whichever loaded first.
 */
export function dashboardSessionLimit(): number {
  return Number(process.env.BERTRAND_MAX_DASHBOARD_SESSIONS ?? 8);
}

/** Thrown when a spawn would exceed {@link dashboardSessionLimit}. */
export class DashboardSessionLimitError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(
      `Refusing to spawn: ${limit} dashboard sessions are already running ` +
        `(BERTRAND_MAX_DASHBOARD_SESSIONS). Stop one before starting another.`,
    );
    this.name = "DashboardSessionLimitError";
    this.limit = limit;
  }
}

export function getDashboardSession(sessionId: string): DashboardSession | undefined {
  return sessions.get(sessionId);
}

export function listDashboardSessions(): string[] {
  return [...sessions.keys()];
}

/**
 * The environment for a daemon-spawned `claude`, built explicitly rather than
 * inherited.
 *
 * `bertrand serve` is long-lived and detached, and inherits its environment
 * from whichever process first triggered `ensureServerStarted` — possibly a
 * hook subprocess. Two variables can't be left to that accident:
 *
 * - `USER`, because `claude` resolves its credentials from the macOS login
 *   keychain and without it reports `Not logged in · Please run /login`, which
 *   misreads as expired auth rather than a broken spawn.
 * - `TERM`, because without it `claude` falls back to a degraded terminfo and
 *   positions text with cursor moves instead of spaces, which xterm.js renders
 *   as mangled spacing.
 */
function buildEnv(vars: Record<string, string>): Record<string, string> {
  const user = process.env.USER ?? process.env.LOGNAME;
  if (!user) {
    throw new Error(
      "Refusing to spawn a dashboard session: USER is absent from the server's " +
        "environment, so `claude` cannot reach the login keychain and would " +
        "report itself logged out. Restart `bertrand serve` from a normal shell.",
    );
  }

  return {
    PATH: process.env.PATH ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? `/Users/${user}`,
    USER: user,
    LOGNAME: user,
    TERM: process.env.TERM ?? "xterm-256color",
    ...vars,
  };
}

export interface SpawnDashboardSessionOpts {
  /** Category path, e.g. "uiid/bertrand". */
  categoryPath: string;
  slug: string;
  name?: string;
}

export interface SpawnDashboardSessionResult {
  sessionId: string;
  claudeId: string;
  pid: number;
  /** Where `claude` was started — the bound repo's checkout. */
  cwd: string;
}

/**
 * Bring a server-owned `claude` up for a session row that already exists, and
 * register it as live.
 *
 * Shared by the two ways a dashboard session starts — a brand new one and a
 * resumed one — because everything after "which conversation, and has Claude
 * seen it" is identical between them. The alternative is a second copy of the
 * PTY, relay, geometry and finalize wiring, which is the divergence #208 was
 * caused by and #209 spent a PR undoing.
 */
function startClaudePty(opts: {
  sessionId: string;
  claudeId: string;
  sessionName: string;
  slug: string;
  contract: string;
  cwd: string;
  /** `claude --resume <id>` when true, `--session-id <id>` when false. */
  resumeExisting: boolean;
}): number {
  const active = resolveActiveProject();
  const env = buildEnv({
    BERTRAND_CLAUDE_ID: opts.claudeId,
    BERTRAND_SESSION: opts.sessionId,
    BERTRAND_SESSION_NAME: opts.sessionName,
    BERTRAND_SESSION_SLUG: opts.slug,
    BERTRAND_PROJECT: active.slug,
    BERTRAND_PROJECT_DB: active.db,
  });

  const entry: DashboardSession = {
    sessionId: opts.sessionId,
    claudeId: opts.claudeId,
    pty: null as unknown as PtyHandle,
    relay: null,
    claim: null,
  };

  const initial = smallestDims(null, null);
  const pty = spawnPty(
    [
      "claude",
      opts.resumeExisting ? "--resume" : "--session-id",
      opts.claudeId,
      "--append-system-prompt",
      opts.contract,
    ],
    {
      cwd: opts.cwd,
      env,
      cols: initial.cols,
      rows: initial.rows,
      onData: (chunk) => entry.relay?.send(chunk),
    },
  );
  entry.pty = pty;
  sessions.set(opts.sessionId, entry);

  // There is no local terminal, so the claim is the whole input to geometry.
  const applyDims = () => {
    const { cols, rows } = smallestDims(null, entry.claim);
    try {
      pty.resize(cols, rows);
    } catch {
      return; // Session already exited.
    }
    entry.relay?.sendDims(cols, rows);
  };

  entry.relay = connectTerminalRelay({
    sessionId: opts.sessionId,
    onInput: (chunk) => pty.write(chunk),
    onSetSize: (dims) => {
      entry.claim = dims;
      applyDims();
    },
    onRepaint: () => {
      const { cols, rows } = smallestDims(null, entry.claim);
      try {
        pty.resize(cols, Math.max(1, rows - 1));
        setTimeout(() => {
          try {
            pty.resize(cols, rows);
          } catch {
            // Exited between the two resizes — nothing to repaint.
          }
        }, 50);
      } catch {
        // Already exited; a repaint request is moot.
      }
    },
  });
  entry.relay.sendDims(initial.cols, initial.rows);

  // The PTY's own PID, not the server's. recoverStaleSessions treats a dead
  // pid as a dead session, so recording the shared, long-lived serve PID here
  // would make every crashed dashboard session look alive forever.
  updateSession(opts.sessionId, {
    status: "active",
    pid: pty.pid,
    pidStartedAt: Date.now(),
  });

  // Deliberately not awaited: this function is synchronous (it returns the pid)
  // and reading a branch shells out to git. The record is session metadata, not
  // something the start depends on, so it settles in the background. It runs
  // outside the resume guard below because the column is current state — a
  // session can resume on a different branch than it left.
  void recordSessionBranch(opts.sessionId, opts.cwd).catch(() => {
    // The read itself cannot reject — it answers null instead. This catches
    // the row write, and exists because an unhandled rejection on a floating
    // promise would take down the server, whereas the TUI path can let the
    // same failure surface (see the note on recordSessionBranch).
  });

  // Only when Claude has no transcript for this conversation — i.e. it is
  // starting rather than continuing. Emitting on a true `--resume` would
  // record a second start for one continuous conversation, splitting the
  // dashboard timeline into a chapter that never began.
  if (!opts.resumeExisting) {
    emitClaudeStarted({
      sessionId: opts.sessionId,
      conversationId: opts.claudeId,
      cwd: opts.cwd,
    });
  }

  pty.exited.then(
    (code) => finalize(opts.sessionId, opts.claudeId, code),
    () => finalize(opts.sessionId, opts.claudeId, 1),
  );

  return pty.pid;
}

export async function spawnDashboardSession(
  opts: SpawnDashboardSessionOpts,
): Promise<SpawnDashboardSessionResult> {
  // The repo is derived, never supplied. A caller-provided path would let the
  // browser start a session against any directory on the machine, and the
  // server's own cwd is an inherited accident with no relation to the session
  // — the project's binding is the only answer that means anything.
  //
  // Resolved before the capacity check because an unbound project is a
  // permanent misconfiguration with a specific remedy, while being at capacity
  // is transient: reporting "too many sessions" to someone whose real problem
  // is an unlinked project sends them chasing the wrong fix.
  const repo = requireBoundRepo(resolveActiveProject().slug);

  // Checked before any row is written: a rejected spawn must leave no trace.
  // The map holds only live sessions (finalize deletes the entry), so this
  // counts what is actually running, not what has ever run.
  if (sessions.size >= dashboardSessionLimit()) {
    throw new DashboardSessionLimitError(dashboardSessionLimit());
  }

  // A dashboard session runs directly in the bound repo's checkout. It used to
  // get its own worktree cut from that checkout (#210), which is what made
  // spawn able to fail before any row was written; with worktrees gone there
  // is no pre-row step left to fail, so the row is simply created.
  const categoryId = getOrCreateCategoryPath(opts.categoryPath);
  const session = createSession({
    categoryId,
    slug: opts.slug,
    name: opts.name ?? opts.slug,
  });

  const claudeId = randomUUID();
  createConversation({ id: claudeId, sessionId: session.id });

  const sessionName = `${opts.categoryPath}/${opts.slug}`;
  const pid = startClaudePty({
    sessionId: session.id,
    claudeId,
    sessionName,
    slug: opts.slug,
    contract: buildContract(
      sessionName,
      helpText({ agent: true }),
      buildSiblingContext(session.id),
    ),
    // What `emitClaudeStarted` records as the session's cwd, and what resume
    // reads back later.
    cwd: repo.path,
    // A conversation minted a line ago; Claude has never heard of it.
    resumeExisting: false,
  });

  return { sessionId: session.id, claudeId, pid, cwd: repo.path };
}

export type ResumeDashboardSessionResult =
  | { ok: true; sessionId: string; claudeId: string; pid: number }
  | {
      ok: false;
      reason:
        | "not-found"
        | "conversation-not-found"
        | "already-running"
        | "no-cwd"
        | "worktree-gone"
        | "at-capacity";
      limit?: number;
    };

type SessionCwdResult =
  | { ok: true; cwd: string }
  | { ok: false; reason: "not-found" | "no-cwd" | "worktree-gone" };

/**
 * Recover the directory a session ran in.
 *
 * Resume has to run `claude` where the session lived, and the server's own cwd
 * is unrelated to it. The last `claude.started` is the durable answer — the
 * *last* one, since a session already resumed may have moved.
 *
 * `worktree_path` is still consulted, but only to *refuse*, and only when it
 * disagrees with the event. Nothing writes that column any more (ELKY-163), so
 * every row carrying one is history — but the two ways of acquiring it left
 * different records behind:
 *
 * - `EnterWorktree` set the column mid-run without emitting a fresh
 *   `claude.started`, so the last event names the **main checkout**. Falling
 *   through would resume isolated work there and commit it to whatever branch
 *   that checkout has out — the failure the worktree resume path existed to
 *   rule out, and dropping the feature does not make those rows safe to
 *   reinterpret.
 * - A dashboard spawn (#210) started `claude` *in* the worktree, so the event
 *   already names it and agreeing records need no special handling.
 *
 * Hence the comparison rather than a bare presence check: refusing on presence
 * alone would also turn away the second kind, whose recorded cwd was correct
 * all along.
 *
 * Retired with the columns themselves in ELKY-164.
 */
function resolveSessionCwd(sessionId: string): SessionCwdResult {
  const session = getSession(sessionId);
  if (!session) return { ok: false, reason: "not-found" };

  const started = getEdgeEventOfType(sessionId, "claude.started", "last");
  const cwd = (started?.meta as Record<string, unknown> | null)?.cwd;
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd)) {
    return { ok: false, reason: "no-cwd" };
  }
  if (session.worktreePath && session.worktreePath !== cwd) {
    return { ok: false, reason: "worktree-gone" };
  }
  return { ok: true, cwd };
}

/**
 * Resume a session under the server's ownership (#214) — the dashboard's
 * equivalent of the TUI exit screen's "Resume".
 *
 * `conversationId` omitted mints a new conversation under the same session,
 * matching the resume picker's "+ New conversation". Which conversation to
 * attach to, and whether Claude has ever seen it, are decided by the shared
 * `planResume` rather than re-derived here.
 *
 * Returns a result rather than throwing so the HTTP layer can map each refusal
 * to its own status — at capacity in particular is a condition the user can
 * act on, not a server fault.
 */
export function resumeDashboardSession(opts: {
  sessionId: string;
  conversationId?: string;
}): ResumeDashboardSessionResult {
  // Before anything is written, and before the plan mints a conversation row
  // that a refused resume would leave orphaned.
  if (sessions.has(opts.sessionId)) {
    return { ok: false, reason: "already-running" };
  }
  if (sessions.size >= dashboardSessionLimit()) {
    return { ok: false, reason: "at-capacity", limit: dashboardSessionLimit() };
  }

  // Every refusal here means we cannot honestly pick a working directory, and
  // guessing one would start Claude somewhere the user never worked — or, for
  // `worktree-gone`, somewhere they specifically arranged not to work.
  const resolved = resolveSessionCwd(opts.sessionId);
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  const { cwd } = resolved;

  const planned = planResume({
    sessionId: opts.sessionId,
    conversationId: opts.conversationId,
    cwd,
  });
  if (!planned.ok) return { ok: false, reason: planned.reason };

  const { session, sessionName, contract, conversationId, resumeExisting } =
    planned.plan;

  const pid = startClaudePty({
    sessionId: session.id,
    claudeId: conversationId,
    sessionName,
    slug: session.slug,
    contract,
    cwd,
    resumeExisting,
  });

  return { ok: true, sessionId: session.id, claudeId: conversationId, pid };
}

/** Stop a dashboard-owned session. The PTY outlives every viewer, so ending
 *  one is an explicit act rather than a side effect of closing a tab. */
export function stopDashboardSession(sessionId: string): boolean {
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  entry.pty.kill("SIGTERM");
  return true;
}

function finalize(sessionId: string, conversationId: string, exitCode: number): void {
  const entry = sessions.get(sessionId);
  // Before the close: browsers keep their sockets open when upstream
  // disconnects, so closing first would leave them attached to a terminal that
  // is simply never going to say anything again.
  entry?.relay?.sendEnded(exitCode);
  entry?.relay?.close();
  sessions.delete(sessionId);

  // Shared with the CLI path so summaries, timing, marker pruning and sync push
  // can't silently diverge. stopServerWhenIdle is false because this runs
  // inside the server: stopping it would kill the process executing this line,
  // along with every other dashboard-owned session and any attached browser.
  finalizeSessionRow(sessionId, conversationId, exitCode, { stopServerWhenIdle: false });
}
