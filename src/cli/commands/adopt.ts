/**
 * `bertrand adopt` — attach a bertrand session to a claude that bertrand did
 * not launch (ELKY-179 Task 2).
 *
 * The launch path owns the whole lifecycle: it mints the conversation id,
 * spawns claude with it, and exports `BERTRAND_SESSION` so every hook knows
 * which session it is firing for. A claude started by an ADE, by orca, or by
 * hand has none of that, and env cannot be injected into a running process —
 * hook subprocesses inherit claude's spawn-time environment.
 *
 * So adoption runs the same session-start sequence in reverse: it takes
 * claude's own session id, builds the rows around it, and leaves a marker in
 * `~/.bertrand/run/` that the hook guards consult when their env is empty.
 * From the next hook fire onward the session is indistinguishable from a
 * launched one.
 *
 * Nothing is asked of the user. Sessions have gone in unnamed and been named
 * at pause since ELKY-172, so adoption creates a `derived` row with a
 * placeholder slug and lets the existing derivation name it.
 */

import { register } from "@/cli/router";
import { emitClaudeStarted } from "@/db/events/emit";
import { ingestTranscript } from "@/db/events/ingest";
import {
  createConversation,
  getConversation,
} from "@/db/queries/conversations";
import {
  createSession,
  getSession,
  untakenPlaceholderSlug,
  updateSession,
} from "@/db/queries/sessions";
import { writeAdoptionMarker } from "@/hooks/runtime";
import { processStartedAt } from "@/lib/process-identity";
import { applyProjectFlag, extractProjectFlag } from "@/lib/projects/cli-flag";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { recordSessionBranch } from "@/lib/session-branch";
import { findClaudeTranscript } from "@/lib/transcript";

export interface AdoptOpts {
  /**
   * Claude's own session id. Read from `CLAUDE_CODE_SESSION_ID`, and identical
   * to the `session_id` the hook payload carries — which is what makes the
   * marker resolvable from inside a hook.
   */
  claudeSessionId: string;
  /** The directory claude is running in; the branch is read from it. */
  cwd: string;
  /**
   * Claude's pid (`CLAUDE_PID`), not this process's. Recording it is what lets
   * an adopted session take part in the ordinary lifecycle: `update` refuses
   * status flips on a row with a null pid, and stale-session recovery uses the
   * pid to finalize the session once claude exits.
   */
  pid: number | null;
  /**
   * Import the conversation so far. On by default — adoption almost always
   * happens some turns in, and ingestion is cursor-based, so the alternative
   * is a session whose history starts mid-thought.
   */
  backfill?: boolean;
  /**
   * Transcript to back-fill from. Resolved from `claudeSessionId` and `cwd`
   * when omitted; callers that already hold the path (a hook payload carries
   * `transcript_path`) can skip the directory scan.
   */
  transcriptPath?: string;
  /**
   * `BERTRAND_SESSION`, when set. Its presence means this claude was launched
   * by bertrand and is already tracked, so adoption declines rather than
   * building a second session around the same conversation.
   */
  launchedSessionId?: string;
}

export type AdoptOutcome =
  | {
      ok: true;
      sessionId: string;
      slug: string;
      claudeSessionId: string;
      project: string;
      pid: number | null;
      pidStartedAt: number | null;
      backfilledEvents: number;
    }
  | {
      ok: false;
      reason: "already-launched" | "already-adopted";
      sessionId: string;
      message: string;
    };

/**
 * Adopt `claudeSessionId` into a new session.
 *
 * Both refusals report the session that already owns the conversation, so a
 * caller can carry on with it instead of treating adoption as failed.
 */
export async function runAdopt(opts: AdoptOpts): Promise<AdoptOutcome> {
  if (opts.launchedSessionId) {
    return {
      ok: false,
      reason: "already-launched",
      sessionId: opts.launchedSessionId,
      message:
        `This claude was launched by bertrand (session ${opts.launchedSessionId}) ` +
        `and is already being recorded — nothing to adopt.`,
    };
  }

  // The conversation row is the source of truth for "already adopted": the
  // marker can be swept or hand-deleted, the row cannot. A second session
  // around one conversation would split its timeline in two.
  const existing = getConversation(opts.claudeSessionId);
  if (existing) {
    const session = getSession(existing.sessionId);
    return {
      ok: false,
      reason: "already-adopted",
      sessionId: existing.sessionId,
      message:
        `This conversation is already recorded as session ` +
        `${session?.slug ?? existing.sessionId} — nothing to adopt.`,
    };
  }

  const project = resolveActiveProject().slug;

  // Unnamed and 'derived', exactly like every session since ELKY-172. The
  // placeholder holds the unique-slug index until the first pause derives a
  // real name from what the conversation turned out to be about.
  const session = createSession({
    slug: untakenPlaceholderSlug(),
    nameSource: "derived",
  });

  createConversation({ id: opts.claudeSessionId, sessionId: session.id });

  // Derived from `ps`, never `Date.now()`: see processStartedAt. A claude that
  // has been running longer than the identity check's tolerance would
  // otherwise be reaped as stale a minute after adoption.
  const pidStartedAt =
    opts.pid == null ? null : await processStartedAt(opts.pid);

  updateSession(session.id, {
    status: "active",
    pid: opts.pid,
    pidStartedAt,
  });

  await recordSessionBranch(session.id, opts.cwd);

  emitClaudeStarted({
    sessionId: session.id,
    conversationId: opts.claudeSessionId,
    cwd: opts.cwd,
  });

  // Written after the rows exist. The marker is what makes the hooks start
  // resolving this session, and a hook that fires against a half-built
  // session would record events with nowhere to hang them.
  writeAdoptionMarker(opts.claudeSessionId, { sessionId: session.id, project });

  let backfilledEvents = 0;
  if (opts.backfill !== false) {
    const transcriptPath =
      opts.transcriptPath ??
      findClaudeTranscript(opts.claudeSessionId, opts.cwd) ??
      undefined;
    if (transcriptPath) {
      // flush: true — adoption is a turn boundary from the transcript's point
      // of view, so trailing thinking with no text after it should land rather
      // than sit pending until the next hook tick.
      backfilledEvents = ingestTranscript({
        sessionId: session.id,
        conversationId: opts.claudeSessionId,
        transcriptPath,
        flush: true,
      }).emitted;
    }
  }

  return {
    ok: true,
    sessionId: session.id,
    slug: session.slug,
    claudeSessionId: opts.claudeSessionId,
    project,
    pid: opts.pid,
    pidStartedAt,
    backfilledEvents,
  };
}

/** `--name value` or `--name=value`, whichever form the caller used. */
function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const USAGE = `Usage: bertrand adopt [options]

Attach a bertrand session to the claude session running in this terminal.
Defaults come from claude's own environment, so the bare command is the
normal invocation.

  --claude-id <uuid>   Claude session id (default: $CLAUDE_CODE_SESSION_ID)
  --pid <n>            Claude's pid (default: $CLAUDE_PID)
  --cwd <path>         Directory claude is running in (default: cwd)
  --no-backfill        Skip importing the conversation so far
  --project <slug>     Adopt into a project other than the active one
  --json               Machine-readable result`;

register("adopt", async (args) => {
  const { project, rest } = extractProjectFlag(args);
  applyProjectFlag(project);

  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const json = rest.includes("--json");

  const claudeSessionId =
    flag(rest, "claude-id") ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!claudeSessionId) {
    console.error(
      "No claude session id. CLAUDE_CODE_SESSION_ID is unset — run this from " +
        "inside a Claude Code session, or pass --claude-id <uuid>.",
    );
    process.exit(1);
  }

  const rawPid = flag(rest, "pid") ?? process.env.CLAUDE_PID;
  const pid = rawPid && /^\d+$/.test(rawPid) ? Number(rawPid) : null;

  const outcome = await runAdopt({
    claudeSessionId,
    cwd: flag(rest, "cwd") ?? process.cwd(),
    pid,
    backfill: !rest.includes("--no-backfill"),
    launchedSessionId: process.env.BERTRAND_SESSION || undefined,
  });

  if (json) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (!outcome.ok) {
    console.log(outcome.message);
  } else {
    console.log(`Adopted this claude session as ${outcome.slug}.`);
    console.log(`  project: ${outcome.project}`);
    if (outcome.backfilledEvents > 0) {
      console.log(
        `  back-filled ${outcome.backfilledEvents} events from the conversation so far`,
      );
    }
    if (outcome.pid == null) {
      // Without a pid the row cannot change status (`update` refuses flips on
      // a null pid) and nothing will finalize it when claude exits.
      console.log(
        `  warning: claude's pid is unknown, so this session will not track ` +
          `status or end cleanly. Re-run with --pid <n> if you have it.`,
      );
    }
  }

  // Both refusals mean the conversation is already recorded — the state the
  // caller wanted holds, so this is not a failure to report as one. `--json`
  // still carries `ok: false` for callers that need to tell them apart.
});
