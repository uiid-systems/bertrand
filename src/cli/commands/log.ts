import { register } from "@/cli/router";
import { resolveSessionByName } from "@/db/queries/sessions";
import { getEventsBySession } from "@/db/queries/events";
import { getSessionStats } from "@/db/queries/stats";
import { getConversationsBySession } from "@/db/queries/conversations";
import type { EventRow, SessionRow } from "@/types";
import { enrichAll, type EnrichedEvent } from "@/lib/catalog";
import { compact } from "@/lib/compact";
import { computeSessionStats } from "@/lib/timing";
import { parseDbTime, truncate } from "@/lib/format";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { applyProjectFlag, extractProjectFlag } from "@/lib/projects/cli-flag";
import {
  digestSession,
  segmentByConversation,
  type ConversationEvents,
} from "@/lib/digest";

/**
 * `bertrand log` — agent-first session record, three zoom levels
 * (see docs/agent-cli.md):
 *
 *   log <session>            digest: subject, decision trail, files, outcome
 *   log <session> --events   filtered timeline (--conversation/--type/--since/--limit)
 *   log <session> --full     complete record — dashboard parity, ~100KB+
 *
 * Output is always JSON: the CLI's consumer is an agent; humans have the TUI
 * and the dashboard. Bare `--json` returns the full record — contracts
 * injected before the digest rework promised exactly that — but it defers to
 * `--events`, whose callers postdate the rework and want the filtered view.
 */

const EVENT_SUMMARY_MAX = 500;

const USAGE = `Usage: bertrand log <category>/<slug> [--events | --full]
  --events flags: --conversation <ordinal|id-prefix> --type <t,…> --since <ISO|24h|30m> --limit <n>
  --type accepts groups (qa, prompt, assistant, tool, lifecycle) or raw event names.
Run \`bertrand list\` to see sessions.`;

const HINT =
  "bertrand log <session> --events [--conversation N] [--type qa,prompt,assistant,tool,lifecycle] [--since 24h] [--limit N] for the timeline; --full for the complete record.";

const TYPE_GROUPS: Record<string, string[]> = {
  qa: ["session.waiting", "session.answered"],
  prompt: ["user.prompt"],
  assistant: ["assistant.message"],
  tool: ["tool.used", "tool.work", "tool.applied"],
  lifecycle: [
    "claude.started",
    "claude.ended",
    "claude.discarded",
    "worktree.entered",
    "worktree.exited",
  ],
};

// --- Flag parsing ---

type LogFlags = {
  events: boolean;
  full: boolean;
  json: boolean;
  type?: string;
  conversation?: string;
  since?: string;
  limit?: number;
  target?: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseFlags(args: string[]): LogFlags {
  const flags: LogFlags = { events: false, full: false, json: false };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--events":
        flags.events = true;
        break;
      case "--full":
        flags.full = true;
        break;
      case "--json":
        // Recorded separately, resolved at dispatch: bare --json means the
        // old full record; --events --json keeps the filtered timeline.
        flags.json = true;
        break;
      case "--type":
      case "--conversation":
      case "--since":
      case "--limit": {
        const value = args[++i];
        if (!value) fail(`${arg} requires a value.\n${USAGE}`);
        if (arg === "--limit") {
          const n = Number.parseInt(value, 10);
          if (!Number.isInteger(n) || n <= 0) fail(`--limit must be a positive integer, got: ${value}`);
          flags.limit = n;
        } else {
          flags[arg.slice(2) as "type" | "conversation" | "since"] = value;
        }
        break;
      }
      default:
        if (arg.startsWith("--")) fail(`Unknown flag: ${arg}\n${USAGE}`);
        positional.push(arg);
    }
  }

  flags.target = positional[0];
  return flags;
}

/** Every event name that can appear post-compaction. */
const KNOWN_EVENT_NAMES = new Set(Object.values(TYPE_GROUPS).flat());

/** Expand --type tokens: groups from TYPE_GROUPS, or catalog event names. */
function expandTypes(csv: string): Set<string> {
  const types = new Set<string>();
  for (const token of csv.split(",").map((t) => t.trim()).filter(Boolean)) {
    const group = TYPE_GROUPS[token];
    if (group) {
      group.forEach((t) => types.add(t));
    } else if (token.includes(".")) {
      // Dotted names outside the catalog still pass — real databases carry
      // event types from older binaries (permission.request, session.resumed,
      // …) that --events prints and must stay filterable. The stderr warning
      // is the loud signal for typos, without breaking legacy names.
      if (!KNOWN_EVENT_NAMES.has(token)) {
        console.error(`warning: --type ${token} is not a known event type — results may be empty`);
      }
      types.add(token);
    } else {
      fail(`Unknown --type: ${token} (groups: ${Object.keys(TYPE_GROUPS).join(", ")}, or an event name like user.prompt)`);
    }
  }
  // Compaction rolls runs of tool.used into synthetic tool.work rows before
  // filtering, so a bare tool.used filter would never match anything.
  if (types.has("tool.used")) types.add("tool.work");
  return types;
}

/** "24h" / "30m" / "7d" / "90s" relative to now, or any Date.parse-able string. */
function parseSince(value: string): number {
  const rel = value.match(/^(\d+)([smhd])$/);
  if (rel) {
    const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "s" | "m" | "h" | "d"];
    return Date.now() - Number(rel[1]) * unit;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) fail(`--since must be an ISO date or relative like 24h/30m, got: ${value}`);
  return t;
}

// --- Digest (default) ---

const LIVE_STATUSES = new Set(["active", "waiting", "blocked"]);

function statsBlock(session: SessionRow) {
  // The stored stats row is only recomputed at finalize, so for a live
  // session (including a finalized-then-resumed one) it's stale — compute
  // from events instead. Stored rows serve paused/archived sessions.
  const stats = LIVE_STATUSES.has(session.status) ? null : getSessionStats(session.id);
  if (stats) {
    const { sessionId: _sid, updatedAt: _at, ...rest } = stats;
    return rest;
  }
  // computeSessionStats is the same full-shape computation finalize persists
  // and the dashboard's liveStats endpoint serves — using it keeps the live
  // and stored paths shape-identical (incl. linesAdded/linesRemoved/filesTouched).
  return computeSessionStats(session.id);
}

function showDigest(session: SessionRow, sessionName: string) {
  const project = resolveActiveProject();
  const rawEvents = getEventsBySession(session.id);
  const conversations = digestSession(rawEvents);

  console.log(
    JSON.stringify(
      {
        project: { slug: project.slug, name: project.name },
        session: {
          name: sessionName,
          status: session.status,
          summary: session.summary,
          rating: session.rating,
          worktreeBranch: session.worktreeBranch,
          startedAt: session.startedAt,
          updatedAt: session.updatedAt,
        },
        stats: statsBlock(session),
        conversations,
        hint: HINT,
      },
      null,
      2,
    ),
  );
}

// --- Filtered timeline (--events) ---

type TrimmedEvent = {
  event: string;
  at: string;
  conversation: number;
  summary: string;
  files?: string[];
};

function trimEvent(ev: EnrichedEvent, ordinal: number): TrimmedEvent {
  const meta = ev.meta as Record<string, unknown> | null;

  // Prefer the full text over the stored (pre-truncated) summary where the
  // meta carries it; the 500-char cap here is the only truncation applied.
  let text = ev.summary ?? "";
  if (ev.event === "assistant.message" && typeof meta?.text === "string" && meta.text) {
    text = meta.text;
  }

  const trimmed: TrimmedEvent = {
    event: ev.event,
    at: ev.createdAt,
    conversation: ordinal,
    summary: truncate(text, EVENT_SUMMARY_MAX),
  };

  if (ev.event === "tool.applied" && Array.isArray(meta?.permissions)) {
    const files = meta.permissions
      .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>).detail : ""))
      .filter((d): d is string => typeof d === "string" && d.length > 0);
    if (files.length > 0) trimmed.files = [...new Set(files)];
  }

  return trimmed;
}

function matchConversation(segments: ConversationEvents[], selector: string): ConversationEvents[] {
  // Exact id match first: unknown-N ids would otherwise prefix-collide
  // ("unknown-1" must not also select unknown-10…).
  let matched = segments.filter((s) => s.conversationId === selector);

  // An all-digit selector is normally an ordinal. ~2% of 8-char UUID
  // prefixes — which the digest publishes as `id` — are all digits too, so
  // fall through to a prefix match, but only at the published prefix length:
  // a short out-of-range ordinal (a typo, a stale digest) must fail loudly,
  // not silently select whichever UUID happens to start with that digit.
  if (matched.length === 0 && /^\d+$/.test(selector)) {
    matched = segments.filter((s) => s.ordinal === Number(selector));
    if (matched.length === 0 && selector.length >= 8) {
      matched = segments.filter((s) => s.conversationId.startsWith(selector));
    }
  } else if (matched.length === 0) {
    matched = segments.filter((s) => s.conversationId.startsWith(selector));
  }

  if (matched.length === 0) {
    fail(`No conversation matching "${selector}" — session has ${segments.length} conversation(s), ordinals 1–${segments.length}.`);
  }
  return matched;
}

/** Valid JSON array, one event per line — greppable and cheap to stream. */
function printEventLines(items: TrimmedEvent[]) {
  if (items.length === 0) {
    console.log("[]");
    return;
  }
  console.log("[");
  console.log(items.map((item) => "  " + JSON.stringify(item)).join(",\n"));
  console.log("]");
}

function showEvents(session: SessionRow, flags: LogFlags) {
  const rawEvents = getEventsBySession(session.id);
  let segments = segmentByConversation(rawEvents);
  if (flags.conversation) segments = matchConversation(segments, flags.conversation);

  const types = flags.type ? expandTypes(flags.type) : null;
  const sinceMs = flags.since ? parseSince(flags.since) : null;

  let out: TrimmedEvent[] = [];
  for (const segment of segments) {
    // Compaction (tool rollup, Q&A pairing, dedup) runs per conversation so
    // runs of tool calls never merge across a conversation boundary.
    const compacted = compact(enrichAll(segment.events));
    for (const ev of compacted) {
      if (types && !types.has(ev.event)) continue;
      if (sinceMs !== null && parseDbTime(ev.createdAt) < sinceMs) continue;
      out.push(trimEvent(ev, segment.ordinal));
    }
  }

  if (flags.limit) out = out.slice(-flags.limit); // tail: the latest N

  printEventLines(out);
}

// --- Complete record (--full) ---

function showFull(session: SessionRow, sessionName: string) {
  const project = resolveActiveProject();
  const rawEvents = getEventsBySession(session.id);
  const compacted = compact(enrichAll(rawEvents));
  const stats = getSessionStats(session.id);
  // The stored eventCount column is never written; report the real count.
  const conversations = getConversationsBySession(session.id).map((c) => ({
    ...c,
    eventCount: rawEvents.filter((e: EventRow) => e.conversationId === c.id).length,
  }));

  console.log(
    JSON.stringify(
      {
        project: { slug: project.slug, name: project.name },
        session: { ...session, name: sessionName },
        stats,
        conversations,
        events: compacted.map((e) => ({
          event: e.event,
          label: e.label,
          category: e.category,
          summary: e.summary,
          meta: e.meta,
          createdAt: e.createdAt,
          claudeId: e.claudeId,
        })),
      },
      null,
      2,
    ),
  );
}

// --- Command ---

register("log", async (args) => {
  const { project: projectSlug, rest: argsWithoutProject } = extractProjectFlag(args);
  applyProjectFlag(projectSlug);

  const flags = parseFlags(argsWithoutProject);

  if (!flags.target) fail(USAGE);

  const resolved = resolveSessionByName(flags.target);
  if (!resolved) fail(`Session not found: ${flags.target}`);

  const sessionName = `${resolved.categoryPath}/${resolved.slug}`;

  // Bare --json means the pre-rework full record; alongside --events it's a
  // no-op so filter flags are never silently discarded.
  if (flags.full || (flags.json && !flags.events)) showFull(resolved.session, sessionName);
  else if (flags.events) showEvents(resolved.session, flags);
  else showDigest(resolved.session, sessionName);
});
