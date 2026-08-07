import { randomUUID } from "crypto";
import { createSession, updateSession } from "@/db/queries/sessions";
import { createConversation } from "@/db/queries/conversations";
import { emitClaudeStarted } from "@/db/events/emit";
import { getOrCreateCategoryPath } from "@/db/queries/categories";
import { finalizeSessionRow } from "./finalize";
import { resolveActiveProject } from "@/lib/projects/resolve";
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
 */
export const MAX_DASHBOARD_SESSIONS = Number(
  process.env.BERTRAND_MAX_DASHBOARD_SESSIONS ?? 8,
);

/** Thrown when a spawn would exceed {@link MAX_DASHBOARD_SESSIONS}. */
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
  /** Working directory for `claude`. Passed explicitly — the server's own cwd
   *  is an inherited accident with no relation to the session. */
  cwd: string;
}

export interface SpawnDashboardSessionResult {
  sessionId: string;
  claudeId: string;
  pid: number;
}

export function spawnDashboardSession(
  opts: SpawnDashboardSessionOpts,
): SpawnDashboardSessionResult {
  // Checked before any row is written: a rejected spawn must leave no trace.
  // The map holds only live sessions (finalize deletes the entry), so this
  // counts what is actually running, not what has ever run.
  if (sessions.size >= MAX_DASHBOARD_SESSIONS) {
    throw new DashboardSessionLimitError(MAX_DASHBOARD_SESSIONS);
  }

  const categoryId = getOrCreateCategoryPath(opts.categoryPath);
  const session = createSession({
    categoryId,
    slug: opts.slug,
    name: opts.name ?? opts.slug,
  });

  const claudeId = randomUUID();
  createConversation({ id: claudeId, sessionId: session.id });

  const sessionName = `${opts.categoryPath}/${opts.slug}`;
  const active = resolveActiveProject();
  const contract = buildContract(
    sessionName,
    helpText({ agent: true }),
    buildSiblingContext(session.id),
  );

  const env = buildEnv({
    BERTRAND_CLAUDE_ID: claudeId,
    BERTRAND_SESSION: session.id,
    BERTRAND_SESSION_NAME: sessionName,
    BERTRAND_SESSION_SLUG: opts.slug,
    BERTRAND_PROJECT: active.slug,
    BERTRAND_PROJECT_DB: active.db,
  });

  const entry: DashboardSession = {
    sessionId: session.id,
    claudeId,
    pty: null as unknown as PtyHandle,
    relay: null,
    claim: null,
  };

  const initial = smallestDims(null, null);
  const pty = spawnPty(["claude", "--session-id", claudeId, "--append-system-prompt", contract], {
    cwd: opts.cwd,
    env,
    cols: initial.cols,
    rows: initial.rows,
    onData: (chunk) => entry.relay?.send(chunk),
  });
  entry.pty = pty;
  sessions.set(session.id, entry);

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
    sessionId: session.id,
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
  updateSession(session.id, {
    status: "active",
    pid: pty.pid,
    pidStartedAt: Date.now(),
  });
  emitClaudeStarted({
    sessionId: session.id,
    conversationId: claudeId,
    cwd: opts.cwd,
  });

  pty.exited.then(
    (code) => finalize(session.id, claudeId, code),
    () => finalize(session.id, claudeId, 1),
  );

  return { sessionId: session.id, claudeId, pid: pty.pid };
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
