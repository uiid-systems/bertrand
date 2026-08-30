/**
 * Cross-session pointer search (docs/agent-cli.md, Spec 3).
 *
 * Answers "did we already discuss/decide X?" without knowing which session
 * holds it. Returns pointers — session, conversation ordinal, a snippet —
 * never payloads; the drill-in path is `bertrand log <session> --events
 * --conversation N`. Matching is AND-of-terms, case-insensitive, via SQL
 * LIKE over json_extract — at bertrand's scale (thousands of events per
 * project) this stays well under 10ms, so no FTS table until scale demands.
 *
 * Every function takes an explicit Db handle so `--all-projects` can sweep
 * sibling project databases via getDbForProject().
 */

import { and, eq, desc, inArray, like, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { EventRow } from "@/types";
import { events, sessions } from "@/db/schema";
import { getSessionByAlias } from "@/db/queries/session-aliases";
import { parseSessionName } from "@/lib/parse-session-name";
import { segmentByConversation } from "@/lib/digest";

export const SEARCH_TYPES = [
  "prompt",
  "question",
  "answer",
  "assistant",
  "tool",
  "summary",
] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** Types searched when --type is omitted. `tool` (commands, file paths) is
 *  high-noise, so it's opt-in. */
export const DEFAULT_SEARCH_TYPES: SearchType[] = [
  "prompt",
  "question",
  "answer",
  "assistant",
  "summary",
];

/** Event-backed search types: which event rows to scan, and where the
 *  searchable text lives inside meta. `answer` matches against the answers
 *  object's JSON text — keys (the questions) included, which is acceptable
 *  double-coverage rather than a precision problem. */
const EVENT_SOURCES: Record<
  Exclude<SearchType, "summary">,
  { event: string; jsonPath: string }
> = {
  prompt: { event: "user.prompt", jsonPath: "$.prompt" },
  question: { event: "session.waiting", jsonPath: "$.question" },
  answer: { event: "session.answered", jsonPath: "$.answers" },
  assistant: { event: "assistant.message", jsonPath: "$.text" },
  tool: { event: "tool.used", jsonPath: "$.detail" },
};

export type SearchHit = {
  project: string;
  session: string;
  status: string;
  /** 1-based conversation ordinal within the session; null for summary hits
   *  and legacy events that predate conversation tracking. */
  conversation: number | null;
  type: SearchType;
  at: string;
  snippet: string;
};

export type SearchOpts = {
  terms: string[];
  types?: SearchType[];
  /** Restrict to one session by slug, or by any name it has been known as. */
  session?: string;
  limit?: number;
};

const SNIPPET_RADIUS = 80;
export const DEFAULT_LIMIT = 20;

/** Escape LIKE wildcards in a user term; used with ESCAPE '\'. */
function likePattern(term: string): string {
  return "%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
}

/**
 * ASCII-only lowercase, mirroring SQLite's lower(). A full-Unicode
 * toLowerCase would fold "Ü" in the term while lower() leaves the stored
 * "Ü" alone — making uppercase non-ASCII terms unmatchable even against
 * identical text. With ASCII folding, ASCII matches are case-insensitive
 * and non-ASCII matches are exact-case (SQLite's own LIKE limitation
 * without the ICU extension).
 */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function likeClause(column: SQL, term: string): SQL {
  return sql`${like(sql`lower(${column})`, likePattern(asciiLower(term)))} ESCAPE '\\'`;
}

/** ±SNIPPET_RADIUS chars around the first match, whitespace-collapsed. */
export function makeSnippet(text: string, firstTerm: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const idx = flat.toLowerCase().indexOf(firstTerm.toLowerCase());
  if (idx === -1) return flat.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(flat.length, idx + firstTerm.length + SNIPPET_RADIUS);
  return (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
}

type SessionInfo = { name: string; status: string };

/** id → slug + status, for hydrating hits. */
function loadSessionIndex(db: Db): Map<string, SessionInfo> {
  const rows = db
    .select({
      id: sessions.id,
      slug: sessions.slug,
      status: sessions.status,
    })
    .from(sessions)
    .all();
  return new Map(rows.map((r) => [r.id, { name: r.slug, status: r.status }]));
}

/**
 * `--session <name>` → session id, or undefined when this project has no such
 * session. Retired names resolve too: `log`, `stats`, `archive`, and `rename`
 * all reach a session by any name it has ever had, and search silently
 * returning zero hits for one of those names reads as "nothing here" rather
 * than "wrong name". Db-scoped rather than `resolveSessionByName` because
 * search runs across every project's database, not just the active one.
 */
function resolveSessionFilter(
  db: Db,
  sessionIndex: Map<string, SessionInfo>,
  name: string,
): string | undefined {
  let slug: string;
  try {
    ({ slug } = parseSessionName(name));
  } catch {
    return undefined; // malformed name — no session can match it
  }
  const match = [...sessionIndex.entries()].find(([, info]) => info.name === slug);
  if (match) return match[0];
  return getSessionByAlias(slug, db)?.session.id;
}

/**
 * event id → conversation ordinal for the given sessions, derived from event
 * segmentation — the SAME numbering `log --events --conversation N` and the
 * digest use. Deriving from the conversations table instead would disagree
 * whenever leading legacy null-conversationId events form an extra segment.
 * Keyed per EVENT (not per conversation id) because a resumed-earlier
 * conversation can span multiple segments — a hit in the first leg must
 * point at that leg's ordinal, not the last one.
 */
function loadEventOrdinals(db: Db, sessionIds: Set<string>): Map<number, number> {
  const ordinals = new Map<number, number>();
  if (sessionIds.size === 0) return ordinals;

  const rows = db
    .select({
      id: events.id,
      sessionId: events.sessionId,
      conversationId: events.conversationId,
      event: events.event,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(inArray(events.sessionId, [...sessionIds]))
    .orderBy(events.createdAt, events.id)
    .all();

  for (const sessionId of sessionIds) {
    const sessionEvents = rows.filter((r) => r.sessionId === sessionId);
    for (const segment of segmentByConversation(sessionEvents as EventRow[])) {
      for (const ev of segment.events) {
        if (typeof ev.id === "number") ordinals.set(ev.id, segment.ordinal);
      }
    }
  }
  return ordinals;
}

/**
 * Search one project's database. Hits come back newest-first, capped at
 * `limit` (default 20).
 */
export function searchProject(db: Db, projectSlug: string, opts: SearchOpts): SearchHit[] {
  const terms = opts.terms.filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  const types = opts.types?.length ? opts.types : DEFAULT_SEARCH_TYPES;
  const limit = opts.limit ?? DEFAULT_LIMIT;

  const sessionIndex = loadSessionIndex(db);

  let sessionFilter: string | undefined;
  if (opts.session) {
    sessionFilter = resolveSessionFilter(db, sessionIndex, opts.session);
    if (!sessionFilter) return []; // unknown session in this project — no hits here
  }

  const hits: SearchHit[] = [];
  type PendingHit = { hit: SearchHit; sessionId: string; eventId: number };
  const pending: PendingHit[] = [];

  for (const type of types) {
    if (type === "summary") {
      const conditions = [
        sql`${sessions.summary} IS NOT NULL`,
        ...terms.map((t) => likeClause(sql`${sessions.summary}`, t)),
      ];
      if (sessionFilter) conditions.push(eq(sessions.id, sessionFilter));
      const rows = db
        .select({ id: sessions.id, summary: sessions.summary, updatedAt: sessions.updatedAt })
        .from(sessions)
        .where(and(...conditions))
        .orderBy(desc(sessions.updatedAt))
        .limit(limit)
        .all();
      for (const row of rows) {
        const info = sessionIndex.get(row.id);
        if (!info) continue;
        hits.push({
          project: projectSlug,
          session: info.name,
          status: info.status,
          conversation: null,
          type,
          at: row.updatedAt,
          snippet: makeSnippet(row.summary ?? "", terms[0]!),
        });
      }
      continue;
    }

    const source = EVENT_SOURCES[type];
    const column = sql`json_extract(${events.meta}, ${source.jsonPath})`;
    const conditions = [
      eq(events.event, source.event),
      ...terms.map((t) => likeClause(column, t)),
    ];
    if (sessionFilter) conditions.push(eq(events.sessionId, sessionFilter));

    const rows = db
      .select({
        id: events.id,
        sessionId: events.sessionId,
        createdAt: events.createdAt,
        text: sql<string>`${column}`,
      })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .all();

    for (const row of rows) {
      const info = sessionIndex.get(row.sessionId);
      if (!info) continue;
      pending.push({
        sessionId: row.sessionId,
        eventId: row.id,
        hit: {
          project: projectSlug,
          session: info.name,
          status: info.status,
          conversation: null, // resolved below from event segmentation
          type,
          at: row.createdAt,
          snippet: makeSnippet(row.text ?? "", terms[0]!),
        },
      });
    }
  }

  // Resolve ordinals only for sessions that actually have event hits.
  const ordinals = loadEventOrdinals(db, new Set(pending.map((p) => p.sessionId)));
  for (const { hit, eventId } of pending) {
    hit.conversation = ordinals.get(eventId) ?? null;
    hits.push(hit);
  }

  hits.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return hits.slice(0, limit);
}
