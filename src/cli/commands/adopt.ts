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
 *
 * What it no longer asks is *where to file the session*. Adoption used to
 * resolve the active project — the sticky `activeProjectSlug` — which is a
 * value nobody in an adopted claude ever set: it answered with whatever the
 * last `bertrand project switch` had chosen, on a machine where that was
 * usually nothing at all. Measured over the last two days it filed 5 of 8
 * sessions under a project unrelated to the directory they ran in, silently.
 * The group is now derived from the cwd (`@/lib/session-key`), so there is
 * nothing left to be wrong about.
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
  findOpenSessionByGroupKey,
  getSession,
  untakenPlaceholderSlug,
  updateSession,
} from "@/db/queries/sessions";
import { writeAdoptionMarker } from "@/hooks/runtime";
import { processStartedAt } from "@/lib/process-identity";
import { deriveSessionKey, groupKey, type SessionKey } from "@/lib/session-key";
import { sessionKeyColumns } from "@/lib/session-record";
import { findClaudeTranscript } from "@/lib/transcript";
import type { SessionRow } from "@/types";

export interface AdoptOpts {
  /**
   * Claude's own session id. Read from `CLAUDE_CODE_SESSION_ID`, and identical
   * to the `session_id` the hook payload carries — which is what makes the
   * marker resolvable from inside a hook.
   */
  claudeSessionId: string;
  /**
   * The directory claude is running in. Everything about where this session
   * belongs is read from it — see {@link deriveSessionKey}.
   */
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
  /**
   * A key the caller already derived for `cwd`. `deriveSessionKey` costs up to
   * four `git` invocations and `auto-adopt` has to derive one for its own gate
   * before it ever calls in here; passing it through saves the second round.
   * Omitted means derive it, which is what the bare command does.
   */
  sessionKey?: SessionKey;
}

/**
 * The unit of work this session was filed under, as adoption resolved it.
 *
 * Every field can be null: bertrand records sessions in directories that are
 * not repos and must keep doing so. `key` null means ungrouped — the session
 * exists, it simply rolls up with nothing.
 */
export interface AdoptGroup extends SessionKey {
  /** `groupKey(key)`, the value the session row is keyed on. */
  key: string | null;
}

export type AdoptOutcome =
  | {
      ok: true;
      /**
       * True when this call attached the conversation to a session that
       * already existed rather than creating one — either the conversation was
       * already known (a `--resume`), or another conversation on the same
       * group key had a session open (a second claude run on one task).
       */
      reattached: boolean;
      sessionId: string;
      slug: string;
      claudeSessionId: string;
      group: AdoptGroup;
      pid: number | null;
      pidStartedAt: number | null;
      backfilledEvents: number;
    }
  | {
      ok: false;
      reason: "already-launched" | "archived";
      sessionId: string;
      message: string;
    };

/**
 * Adopt `claudeSessionId`: attach it to the session that should hold it, or
 * create that session.
 *
 * Three answers, in order of how directly they identify the session:
 *
 *   1. **The conversation is already known.** A `claude --resume` of an
 *      adopted conversation. Finalizing an adopted session prunes its marker
 *      (there is no bertrand process to keep it fresh), so a resumed
 *      conversation comes back with rows but no marker: the hooks can't
 *      resolve it and the session silently stops recording. Refusing here —
 *      the obvious reading of "already adopted" — would leave it that way
 *      while reporting success-ish. Rewriting the marker instead is
 *      idempotent, and it heals a hand-deleted marker for free.
 *
 *   2. **Another conversation is already open on this group key.** Two claude
 *      runs against one task — a resume from a second terminal, a run that
 *      crashed and was restarted, an `/exit` and a fresh `claude` on the same
 *      branch — become two conversations of one session. This is what the
 *      group key is *for*: before it, `adopt` minted a session per claude run
 *      and `session` was 1:1 with `conversation`, which made the sibling
 *      context bertrand already builds have nothing to group.
 *
 *   3. **Neither.** Mint a session and key it on the cwd.
 *
 * A cwd that resolves to nothing — outside git, or a directory that is gone —
 * takes (3) every time and records an ungrouped session. It must never take
 * (2): an unresolvable key is not evidence that two conversations are the same
 * work, and collapsing every non-repo claude on the machine into one eternal
 * session is the failure the old sticky project already demonstrated.
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

  // Derived once, here, and then passed down: every path below records or
  // refreshes it, and it costs up to four `git` invocations. Carried as one
  // object — the key plus the value computed from it — so the two can never be
  // passed around out of step.
  const derived = opts.sessionKey ?? (await deriveSessionKey(opts.cwd));
  const group: AdoptGroup = { ...derived, key: groupKey(derived) };

  // The conversation row is the source of truth for "already known": the
  // marker can be swept or hand-deleted, the row cannot. A second session
  // around one conversation would split its timeline in two.
  //
  // One indexed lookup against the one database. It used to be a scan across
  // every registered project's DB, because adoption read the active project
  // while a re-attach could land anywhere — a constraint that died with the
  // per-project layout.
  const known = getConversation(opts.claudeSessionId);
  if (known) return attach(known.sessionId, opts, group, { conversationExists: true });

  if (group.key) {
    const open = findOpenSessionByGroupKey(group.key);
    if (open) return attach(open.id, opts, group, { session: open });
  }

  return create(opts, group);
}

/** Mint a session for this conversation and key it on the cwd. */
async function create(
  opts: AdoptOpts,
  group: AdoptGroup,
): Promise<AdoptOutcome> {
  // Unnamed and 'derived', exactly like every session since ELKY-172. The
  // placeholder holds the unique-slug index until the first pause derives a
  // real name from what the conversation turned out to be about.
  // Split back apart because `CreateSessionOpts` takes the key's own columns
  // and a `groupKey` beside them, not the combined shape the outcome reports.
  const { key: groupKeyValue, ...sessionKey } = group;
  const session = createSession({
    slug: untakenPlaceholderSlug(),
    nameSource: "derived",
    // The key's fields are persisted verbatim alongside the value computed
    // from them: the row has to answer "where did this run?" for the dashboard
    // and for `--resume` without re-shelling out to git, and the pieces are not
    // recoverable from the key (`<repo>@<branch>` cannot name a worktree).
    ...sessionKey,
    groupKey: groupKeyValue,
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

  emitClaudeStarted({
    sessionId: session.id,
    conversationId: opts.claudeSessionId,
    cwd: opts.cwd,
  });

  // Written after the rows exist. The marker is what makes the hooks start
  // resolving this session, and a hook that fires against a half-built
  // session would record events with nowhere to hang them.
  writeAdoptionMarker(opts.claudeSessionId, {
    sessionId: session.id,
    pid: opts.pid ?? undefined,
  });

  return {
    ok: true,
    reattached: false,
    sessionId: session.id,
    slug: session.slug,
    claudeSessionId: opts.claudeSessionId,
    group,
    pid: opts.pid,
    pidStartedAt,
    backfilledEvents: backfill(session.id, opts),
  };
}

/**
 * Point the hooks at a session that already exists, and make this
 * conversation one of its own.
 *
 * Everything written here is state that has gone stale while nothing was
 * watching: the marker (pruned at finalize), the pid (claude has a new one
 * after a resume), the key (a resumed conversation can come back in a
 * different worktree, or on a branch that was renamed under it), and the
 * status (`paused`, from the last Stop hook). The session's own rows are left
 * exactly as they are — this is that session continuing, not a new one.
 *
 * The status flips are gated on knowing claude's pid; the key refresh is not.
 * Without a pid the session could never be closed again, so its previous close
 * is left standing rather than undone for nothing — but the key is plain
 * current state, and a stale one silently mis-files the session no matter what
 * the status column says.
 */
async function attach(
  sessionId: string,
  opts: AdoptOpts,
  group: AdoptGroup,
  known: {
    /** The row, when the caller already read it. Saves an indexed lookup. */
    session?: SessionRow;
    /**
     * True on the resume path, where the conversation row is what identified
     * the session in the first place. Anything else is a conversation joining
     * a session it has never been part of, and needs a row of its own.
     */
    conversationExists?: boolean;
  } = {},
): Promise<AdoptOutcome> {
  const session = known.session ?? getSession(sessionId);
  if (!session) {
    // A conversation whose session was deleted out from under it. Nothing to
    // attach to, and creating one here would resurrect a deliberate delete.
    return {
      ok: false,
      reason: "archived",
      sessionId,
      message:
        `This conversation belongs to session ${sessionId}, which no ` +
        `longer exists. Start a new claude session to record fresh work.`,
    };
  }

  if (session.status === "archived") {
    // Archiving is how a user says "this one is done". Re-opening it because
    // an old conversation was resumed would undo that silently.
    //
    // Reachable only from the conversation lookup: `findOpenSessionByGroupKey`
    // skips archived rows, so a new conversation on an archived session's
    // group key gets a session of its own rather than this refusal.
    return {
      ok: false,
      reason: "archived",
      sessionId: session.id,
      message:
        `This conversation belongs to ${session.slug}, which is archived. ` +
        `Un-archive it first, or start a new claude session.`,
    };
  }

  // A conversation joining a session that another conversation opened — the
  // whole point of keying sessions on the work — has no row yet. Created
  // before the refresh below so a hook that fires the instant the marker
  // lands has somewhere to hang its events.
  if (!known.conversationExists) {
    createConversation({ id: opts.claudeSessionId, sessionId: session.id });
  }

  const pidStartedAt =
    opts.pid == null ? null : await processStartedAt(opts.pid);

  updateSession(session.id, {
    ...sessionKeyColumns(group),
    // `getRecoverableSessions` keys on a non-null pid, so with a null one
    // nothing can ever finalize this session again — clearing `endedAt` there
    // would strand it `active` forever, trading a correctly closed record for
    // one that never closes. The marker is still worth rewriting: the hooks
    // resolve and record events, they just can't flip status (`update` refuses
    // that on a null pid).
    ...(opts.pid == null
      ? {}
      : { status: "active" as const, pid: opts.pid, pidStartedAt, endedAt: null }),
  });

  writeAdoptionMarker(opts.claudeSessionId, {
    sessionId: session.id,
    pid: opts.pid ?? undefined,
  });

  return {
    ok: true,
    reattached: true,
    sessionId: session.id,
    slug: session.slug,
    claudeSessionId: opts.claudeSessionId,
    group,
    pid: opts.pid,
    pidStartedAt,
    // Catches anything the transcript gained while the session was untracked —
    // the ingest cursor makes it a no-op when there is nothing new.
    backfilledEvents: backfill(session.id, opts),
  };
}

/**
 * Import the conversation so far. Cursor-based, so it is safe to run on every
 * adoption and re-attachment: it emits only what it hasn't seen.
 */
function backfill(sessionId: string, opts: AdoptOpts): number {
  if (opts.backfill === false) return 0;

  const transcriptPath =
    opts.transcriptPath ??
    findClaudeTranscript(opts.claudeSessionId, opts.cwd) ??
    undefined;
  if (!transcriptPath) return 0;

  // flush: true — adoption is a turn boundary from the transcript's point of
  // view, so trailing thinking with no text after it should land rather than
  // sit pending until the next hook tick.
  return ingestTranscript({
    sessionId,
    conversationId: opts.claudeSessionId,
    transcriptPath,
    flush: true,
  }).emitted;
}

/**
 * One line naming the group, for the human running the command by hand.
 *
 * `<repo>@<branch>` is the ordinary answer and reads as itself. The other two
 * need saying out loud: a `path:` key means `origin` could not be parsed, and
 * no key at all means the directory is not a repo — which is a supported way
 * to run, not a failure, so it says what happened rather than warning.
 */
export function describeGroup(group: AdoptGroup, cwd: string): string {
  if (group.repo && group.branch) return `  group: ${group.repo}@${group.branch}`;
  if (group.key) {
    return `  group: ${group.key} (no GitHub origin to roll up under)`;
  }
  return `  group: none — ${cwd} is not a git repo, so this session is recorded ungrouped`;
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

The session is filed under the work its directory names — its repo and
branch — and joins the session already open on that key, if there is one.

  --claude-id <uuid>   Claude session id (default: $CLAUDE_CODE_SESSION_ID)
  --pid <n>            Claude's pid (default: $CLAUDE_PID)
  --cwd <path>         Directory claude is running in (default: cwd)
  --no-backfill        Skip importing the conversation so far
  --json               Machine-readable result`;

register("adopt", async (args) => {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const json = args.includes("--json");

  const claudeSessionId =
    flag(args, "claude-id") ?? process.env.CLAUDE_CODE_SESSION_ID;
  if (!claudeSessionId) {
    console.error(
      "No claude session id. CLAUDE_CODE_SESSION_ID is unset — run this from " +
        "inside a Claude Code session, or pass --claude-id <uuid>.",
    );
    process.exit(1);
  }

  const rawPid = flag(args, "pid") ?? process.env.CLAUDE_PID;
  const pid = rawPid && /^\d+$/.test(rawPid) ? Number(rawPid) : null;
  const cwd = flag(args, "cwd") ?? process.cwd();

  const outcome = await runAdopt({
    claudeSessionId,
    cwd,
    pid,
    backfill: !args.includes("--no-backfill"),
    launchedSessionId: process.env.BERTRAND_SESSION || undefined,
  });

  if (json) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (!outcome.ok) {
    console.log(outcome.message);
  } else {
    // These two first lines are an interface: the `/bertrand` slash command
    // greps them to tell "a session was created" from "an existing one picked
    // this conversation up". Reword the detail below them, not these.
    console.log(
      outcome.reattached
        ? `Re-attached this claude session to ${outcome.slug}.`
        : `Adopted this claude session as ${outcome.slug}.`,
    );
    console.log(describeGroup(outcome.group, cwd));
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

  // `already-launched` exits 0: the conversation is being recorded, just not by
  // adoption, so the state the caller wanted holds. `archived` does not —
  // nothing is recording and the user has to choose what to do about it, so it
  // has to be distinguishable without parsing prose. `--json` carries
  // `ok: false` and the reason either way.
  if (!outcome.ok && outcome.reason === "archived") process.exit(1);
});
