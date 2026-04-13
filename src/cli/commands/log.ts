import { register } from "@/cli/router";
import { getAllSessions, getSessionByGroupSlug } from "@/db/queries/sessions";
import { getEventsBySession } from "@/db/queries/events";
import { getGroupByPath } from "@/db/queries/groups";
import { getSessionStats } from "@/db/queries/stats";
import { enrichAll, type EnrichedEvent } from "@/lib/catalog";
import { compact } from "@/lib/compact";
import { computeTimingsLive } from "@/lib/timing";
import { parseSessionName } from "@/lib/parse-session-name";
import { formatAgo, formatDuration, formatTime, truncate } from "@/lib/format";

// --- ANSI helpers ---

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const PIPE_COLOR = "\x1b[38;5;238m";

function ansi(code: number, text: string): string {
  return `\x1b[${code}m${text}${RESET}`;
}

function ansi256(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}${RESET}`;
}

// --- Status dots ---

const STATUS_DOTS: Record<string, string> = {
  working: ansi(32, "●"),
  blocked: ansi(33, "●"),
  prompting: ansi(36, "●"),
  paused: `${DIM}●${RESET}`,
  archived: `${DIM}○${RESET}`,
};

// --- Session list (no args) ---

function showAllSessions() {
  const rows = getAllSessions()
    .sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime());

  if (rows.length === 0) {
    console.log("No sessions.");
    return;
  }

  const maxName = Math.max(...rows.map((r) => `${r.groupPath}/${r.session.slug}`.length), 4);

  console.log(
    `${DIM}${"  "} ${"NAME".padEnd(maxName)}  ${"STATUS".padEnd(10)}  ${"EVENTS".padEnd(6)}  LAST ACTIVE${RESET}`
  );

  for (const row of rows) {
    const name = `${row.groupPath}/${row.session.slug}`;
    const dot = STATUS_DOTS[row.session.status] ?? "?";
    const stats = getSessionStats(row.session.id);
    const eventCount = String(stats?.eventCount ?? 0).padEnd(6);
    const ago = formatAgo(row.session.updatedAt);
    console.log(
      `${dot} ${name.padEnd(maxName)}  ${row.session.status.padEnd(10)}  ${eventCount}  ${ago}`
    );
  }
}

// --- Timeline rendering ---

const GAP_THRESHOLD_MS = 5000;

type Segment = {
  claudeId: string;
  events: EnrichedEvent[];
};

function segmentByConversation(events: EnrichedEvent[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;

  for (const ev of events) {
    if (ev.event === "claude.started") {
      current = { claudeId: ev.claudeId ?? "unknown", events: [ev] };
      segments.push(current);
    } else if (current) {
      current.events.push(ev);
    } else {
      // Events before first claude.started go into their own segment
      if (segments.length === 0) {
        current = { claudeId: ev.claudeId ?? "unknown", events: [ev] };
        segments.push(current);
      } else {
        segments[segments.length - 1]!.events.push(ev);
      }
    }
  }

  return segments;
}

function renderConnector(idx: number, total: number): string {
  if (total === 1) return `${PIPE_COLOR}─${RESET}`;
  if (idx === 0) return `${PIPE_COLOR}┌${RESET}`;
  if (idx === total - 1) return `${PIPE_COLOR}└${RESET}`;
  return `${PIPE_COLOR}├${RESET}`;
}

function renderGap(prevTime: string, currTime: string): string | null {
  const gap = new Date(currTime).getTime() - new Date(prevTime).getTime();
  if (gap < GAP_THRESHOLD_MS) return null;
  return `${PIPE_COLOR}│${RESET} ${DIM}  ··· ${formatDuration(gap)} ···${RESET}`;
}

function renderEventLine(ev: EnrichedEvent): string {
  const time = formatTime(ev.createdAt);
  const label = ansi256(ev.color, ev.label);
  const detail = ev.summary ? `${DIM}${truncate(ev.summary, 60)}${RESET}` : "";
  return `${DIM}${time}${RESET} ${label}${detail ? ` ${detail}` : ""}`;
}

function renderQAPair(block: EnrichedEvent, resume: EnrichedEvent | undefined): string[] {
  const lines: string[] = [];
  const time = formatTime(block.createdAt);
  const question = block.summary ? truncate(block.summary, 60) : "";
  lines.push(`${DIM}${time}${RESET} ${ansi256(block.color, block.label)}${question ? ` ${DIM}${question}${RESET}` : ""}`);

  if (resume) {
    const answer = resume.summary ? truncate(resume.summary, 60) : "";
    lines.push(`${PIPE_COLOR}│${RESET}   ${ansi256(resume.color, "└ " + resume.label)}${answer ? ` ${DIM}${answer}${RESET}` : ""}`);
  }

  return lines;
}

function renderSegment(seg: Segment, segIdx: number, totalSegs: number) {
  const lines: string[] = [];

  // Conversation header (only if multiple segments)
  if (totalSegs > 1) {
    const header = `${BOLD}Conversation ${segIdx + 1}${RESET}`;
    if (segIdx > 0) lines.push("");
    lines.push(header);
  }

  for (let i = 0; i < seg.events.length; i++) {
    const ev = seg.events[i]!;
    const connector = renderConnector(i, seg.events.length);

    // Gap indicator
    if (i > 0) {
      const gap = renderGap(seg.events[i - 1]!.createdAt, ev.createdAt);
      if (gap) lines.push(gap);
    }

    // Q&A pair rendering
    if (ev.event === "session.block") {
      const next = seg.events[i + 1];
      const resume = next?.event === "session.resume" ? next : undefined;
      const qaLines = renderQAPair(ev, resume);
      lines.push(`${connector} ${qaLines[0]}`);
      for (let j = 1; j < qaLines.length; j++) {
        lines.push(`  ${qaLines[j]}`);
      }
      if (resume) i++; // Skip the resume since we already rendered it
      continue;
    }

    lines.push(`${connector} ${renderEventLine(ev)}`);
  }

  return lines;
}

function renderTimingFooter(sessionId: string): string[] {
  const stats = getSessionStats(sessionId);
  const lines: string[] = [];

  let claudeWorkS: number;
  let userWaitS: number;
  let activePctVal: number;
  let durationS: number;

  if (stats) {
    claudeWorkS = stats.claudeWorkS;
    userWaitS = stats.userWaitS;
    activePctVal = stats.activePct;
    durationS = stats.durationS;
  } else {
    const timing = computeTimingsLive(sessionId);
    claudeWorkS = Math.round(timing.totalClaudeWorkMs / 1000);
    userWaitS = Math.round(timing.totalUserWaitMs / 1000);
    activePctVal = timing.activePct;
    durationS = timing.durationS;
  }

  if (durationS === 0) return lines;

  lines.push("");
  lines.push(
    `${DIM}Duration: ${formatDuration(durationS * 1000)} · Claude: ${formatDuration(claudeWorkS * 1000)} (${activePctVal}%) · Wait: ${formatDuration(userWaitS * 1000)} (${100 - activePctVal}%)${RESET}`
  );

  return lines;
}

function showSessionLog(sessionId: string, sessionName: string, isJson: boolean) {
  const rawEvents = getEventsBySession(sessionId);
  const enriched = enrichAll(rawEvents);
  const compacted = compact(enriched);

  if (isJson) {
    console.log(
      JSON.stringify({
        session: sessionName,
        events: compacted.map((e) => ({
          event: e.event,
          label: e.label,
          category: e.category,
          summary: e.summary,
          createdAt: e.createdAt,
          claudeId: e.claudeId,
        })),
      }, null, 2)
    );
    return;
  }

  const segments = segmentByConversation(compacted);
  const allLines: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segLines = renderSegment(segments[i]!, i, segments.length);
    allLines.push(...segLines);
  }

  allLines.push(...renderTimingFooter(sessionId));

  // Print lines (hybrid: for now always print to stdout, Storm viewport can be added later)
  for (const line of allLines) {
    console.log(line);
  }
}

// --- Command ---

register("log", async (args) => {
  const isJson = args.includes("--json");
  const filteredArgs = args.filter((a) => !a.startsWith("--"));
  const target = filteredArgs[0];

  // No args: show session list with summary
  if (!target) {
    showAllSessions();
    return;
  }

  // Full session log
  const { groupPath, slug } = parseSessionName(target);
  const group = getGroupByPath(groupPath);
  if (!group) {
    console.error(`Group not found: ${groupPath}`);
    process.exit(1);
  }
  const session = getSessionByGroupSlug(group.id, slug);
  if (!session) {
    console.error(`Session not found: ${target}`);
    process.exit(1);
  }

  showSessionLog(session.id, `${groupPath}/${slug}`, isJson);
});
