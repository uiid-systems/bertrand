/**
 * `bertrand auto-adopt` — the hook-fired writer behind ELKY-175.
 *
 * `bertrand adopt` (ELKY-180) does the same work with a human standing behind
 * it: they ran the command, so "should this be recorded at all?" is already
 * answered. Auto-adoption has nobody to ask, so this command is `runAdopt`
 * plus the two gates `docs/session-identity.md` requires it to pass before it
 * may create anything:
 *
 *   1. **This machine has opted in.** `autoAdopt` in `~/.bertrand/config.json`,
 *      off by default, so a machine that upgrades into this feature behaves
 *      exactly as it did before until someone turns it on. The gate used to be
 *      a flag on the project owning the cwd, and the projects are gone — but
 *      the *reason* for a gate is untouched, and it is not "we don't know which
 *      project to use". It is the asymmetry of the cost: one repo wanting its
 *      claudes captured must not enrol every repo on the machine, because
 *      opting in wrongly writes rows for work the user never asked bertrand to
 *      watch, while opting out wrongly costs one `bertrand adopt`.
 *
 *   2. **The cwd resolves to a repo.** A directory that is not a git checkout
 *      has nothing to group a session by — see `groupKey` — and a claude
 *      running in one is overwhelmingly not work: it is a shell in `~`, a
 *      scratch dir, `/tmp`. `bertrand adopt` records those happily, because a
 *      human asked for it; auto-adoption declines and stays a total no-op.
 *
 * Materiality — "has this conversation done enough to be worth a row?" — is
 * the third gate, and it is *not* here: it lives in the hook, which only calls
 * this command from the second user prompt of a conversation onward. Keeping
 * it there costs one `[ -f ]` test instead of a process spawn on every prompt
 * of every claude on the machine, and it also settles the one question the
 * design doc left open — whether a subagent would mint its own session. A
 * subagent never submits a user prompt, so it can never reach this code.
 *
 * Refusals are recorded, not just returned. A decline that will never change
 * for this conversation writes the gate marker non-empty, and the hook's
 * `[ -s ]` test then skips the spawn for every later prompt. Without that,
 * every prompt in every un-opted-in directory on the machine would pay for
 * this command to say no again.
 */

import { register } from "@/cli/router";
import { runAdopt, type AdoptOutcome } from "@/cli/commands/adopt";
import { markAutoCreateDeclined } from "@/hooks/runtime";
import { isAutoAdoptEnabled } from "@/lib/config";
import { deriveSessionKey, groupKey } from "@/lib/session-key";

export interface AutoAdoptOpts {
  /** Claude's own session id — the hook payload's `session_id`. */
  claudeSessionId: string;
  /** The directory claude is running in, from the hook payload. */
  cwd: string;
  /** Claude's pid (`CLAUDE_PID`), which hook subprocesses inherit. */
  pid: number | null;
  /** From the payload, so the back-fill skips the transcript directory scan. */
  transcriptPath?: string;
  /** `BERTRAND_SESSION` — set means bertrand launched this claude. */
  launchedSessionId?: string;
}

/** Why auto-adoption declined to create a session. */
export type AutoAdoptDecline =
  /** Bertrand launched this claude; it is already recorded. */
  | "already-launched"
  /** This machine has not turned automatic adoption on. */
  | "not-opted-in"
  /** The cwd is not in a git repo, so there is nothing to group it by. */
  | "no-repo"
  /** The conversation belongs to a session that is archived or deleted. */
  | "archived";

export type AutoAdoptOutcome =
  | {
      ok: true;
      created: boolean;
      sessionId: string;
      slug: string;
      /** The group the session was filed under, or null when ungrouped. */
      group: string | null;
    }
  | { ok: false; reason: AutoAdoptDecline; message: string };

/**
 * Decline messages. Written for a human reading `bertrand auto-adopt` output
 * by hand — the hook discards stdout — so each one names the thing that would
 * change the answer.
 */
function declineMessage(reason: AutoAdoptDecline, cwd: string): string {
  switch (reason) {
    case "already-launched":
      return "This claude was launched by bertrand and is already being recorded.";
    case "not-opted-in":
      return (
        `This machine does not record claude sessions bertrand didn't launch.\n` +
        `  Turn it on for every repo you work in by setting autoAdopt in\n` +
        `  ~/.bertrand/config.json:\n` +
        `      { "autoAdopt": true }\n` +
        `  Or record just this one, now, with: bertrand adopt`
      );
    case "no-repo":
      return (
        `${cwd} is not a git repository.\n` +
        `  Sessions are grouped by the repo and branch they run in, so there is\n` +
        `  nothing here to file one under. Record it anyway with: bertrand adopt`
      );
    case "archived":
      return "This conversation belongs to a session that is archived or deleted.";
  }
}

/**
 * Run the gates, then adopt.
 *
 * Every `ok: false` return here is a permanent answer for this conversation,
 * so each one marks the gate before returning. A *transient* failure — a
 * locked DB, a git binary that didn't answer — must not: it throws out of
 * here, the hook's `bq` wrapper swallows it, the gate marker stays empty, and
 * the next prompt tries again.
 */
export async function runAutoAdopt(
  opts: AutoAdoptOpts,
): Promise<AutoAdoptOutcome> {
  const decline = (reason: AutoAdoptDecline): AutoAdoptOutcome => {
    markAutoCreateDeclined(opts.claudeSessionId, reason);
    return { ok: false, reason, message: declineMessage(reason, opts.cwd) };
  };

  // Belt-and-braces: the hook guard already resolved and returned when
  // BERTRAND_SESSION was set, so reaching here with one means something
  // called this command directly.
  if (opts.launchedSessionId) return decline("already-launched");

  // Cheapest gate first, and the one that is off on most machines: a single
  // JSON read, no subprocesses. Deriving the key below shells out to `git` up
  // to four times, which is not worth spending to reach the same refusal.
  if (!isAutoAdoptEnabled()) return decline("not-opted-in");

  const key = await deriveSessionKey(opts.cwd);
  if (groupKey(key) === null) return decline("no-repo");

  const outcome: AdoptOutcome = await runAdopt({
    claudeSessionId: opts.claudeSessionId,
    cwd: opts.cwd,
    pid: opts.pid,
    transcriptPath: opts.transcriptPath,
    // Already paid for by the gate above; handed over so `runAdopt` doesn't
    // re-shell for an answer this process already has.
    sessionKey: key,
    // On by default in `adopt` too, and load-bearing here: creation happens a
    // couple of turns in, so without the back-fill the session's history
    // would start mid-thought. Cursor-based, so it costs nothing on re-runs.
    backfill: true,
  });

  if (!outcome.ok) {
    // `already-launched` can't happen (checked above) but is mapped rather
    // than assumed away, so a future change to `runAdopt` can't fall through
    // this branch untyped.
    return decline(outcome.reason === "archived" ? "archived" : "already-launched");
  }

  return {
    ok: true,
    created: !outcome.reattached,
    sessionId: outcome.sessionId,
    slug: outcome.slug,
    group: outcome.group.key,
  };
}

const USAGE = `Usage: bertrand auto-adopt [options]

Record the claude session running in this directory, if this machine has opted
in (autoAdopt in ~/.bertrand/config.json) and the directory is a git repo.
Fired by the UserPromptSubmit hook; the flags exist for testing it by hand.

  --claude-id <uuid>        Claude session id (default: $CLAUDE_CODE_SESSION_ID)
  --cwd <path>              Directory claude is running in (default: cwd)
  --pid <n>                 Claude's pid (default: $CLAUDE_PID)
  --transcript-path <path>  Transcript to back-fill from (default: resolved)
  --json                    Machine-readable result`;

/** `--name value` or `--name=value`, whichever form the caller used. */
function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1) return args[index + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

register("auto-adopt", async (args) => {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

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

  // An empty `--transcript-path ""` reaches here when the payload had no such
  // field; treated as absent so the back-fill falls back to its own lookup.
  const transcriptPath = flag(args, "transcript-path") || undefined;

  const outcome = await runAutoAdopt({
    claudeSessionId,
    cwd: flag(args, "cwd") || process.cwd(),
    pid,
    transcriptPath,
    launchedSessionId: process.env.BERTRAND_SESSION || undefined,
  });

  if (args.includes("--json")) {
    console.log(JSON.stringify(outcome, null, 2));
  } else if (!outcome.ok) {
    console.log(outcome.message);
  } else {
    const where = outcome.group ? ` on ${outcome.group}` : "";
    console.log(
      outcome.created
        ? `Recorded this claude session as ${outcome.slug}${where}.`
        : `Re-attached this claude session to ${outcome.slug}${where}.`,
    );
  }

  // Always exit 0. The caller is a hook whose non-zero exits Claude Code
  // surfaces to the user, and "this machine hasn't opted in" is the normal
  // state of a fresh install, not an error.
});
