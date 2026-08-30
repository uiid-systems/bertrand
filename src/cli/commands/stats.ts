import { register } from "@/cli/router";
import { getAllSessions, resolveSessionByName } from "@/db/queries/sessions";
import { getSessionStats } from "@/db/queries/stats";
import { getEventsBySession } from "@/db/queries/events";
import { computeTimingsLive } from "@/lib/timing";
import { formatDuration } from "@/lib/format";

interface SessionMetrics {
  name: string;
  status: string;
  eventCount: number;
  conversationCount: number;
  interactionCount: number;
  claudeWorkS: number;
  userWaitS: number;
  activePct: number;
  durationS: number;
}

const ACTIVE_STATUSES = ["active", "waiting", "blocked"];

function getMetrics(sessionId: string, name: string, status: string): SessionMetrics {
  const stats = getSessionStats(sessionId);

  if (stats) {
    return { name, status, ...stats };
  }

  // Live fallback for active sessions — compute counts from events
  const timing = computeTimingsLive(sessionId);
  const allEvents = getEventsBySession(sessionId);
  const conversations = new Set<string>();
  let interactionCount = 0;

  for (const ev of allEvents) {
    if (ev.conversationId) conversations.add(ev.conversationId);
    if (ev.event === "session.waiting" || ev.event === "session.answered") interactionCount++;
  }

  return {
    name,
    status,
    eventCount: allEvents.length,
    conversationCount: conversations.size,
    interactionCount,
    claudeWorkS: Math.round(timing.totalClaudeWorkMs / 1000),
    userWaitS: Math.round(timing.totalUserWaitMs / 1000),
    activePct: timing.activePct,
    durationS: timing.durationS,
  };
}

function pct(n: number): string {
  return `${n}%`;
}

function dur(seconds: number): string {
  return seconds > 0 ? formatDuration(seconds * 1000) : "-";
}

// --- Renderers ---

function renderGlobal(
  metrics: SessionMetrics[],
  isJson: boolean
) {
  const totals = metrics.reduce(
    (acc, m) => ({
      sessions: acc.sessions + 1,
      active: acc.active + (ACTIVE_STATUSES.includes(m.status) ? 1 : 0),
      durationS: acc.durationS + m.durationS,
      claudeWorkS: acc.claudeWorkS + m.claudeWorkS,
      userWaitS: acc.userWaitS + m.userWaitS,
      conversations: acc.conversations + m.conversationCount,
      interactions: acc.interactions + m.interactionCount,
    }),
    { sessions: 0, active: 0, durationS: 0, claudeWorkS: 0, userWaitS: 0, conversations: 0, interactions: 0 }
  );

  const totalTracked = totals.claudeWorkS + totals.userWaitS;
  const globalActivePct = totalTracked > 0 ? Math.round((totals.claudeWorkS / totalTracked) * 100) : 0;

  if (isJson) {
    console.log(JSON.stringify({ ...totals, activePct: globalActivePct }, null, 2));
    return;
  }

  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(`${bold}Global Statistics${reset}\n`);
  console.log(`  Sessions:      ${totals.sessions} (${totals.active} active)`);
  console.log(`  Total time:    ${dur(totals.durationS)}`);
  console.log(`  Claude work:   ${dur(totals.claudeWorkS)} ${dim}(${pct(globalActivePct)})${reset}`);
  console.log(`  User wait:     ${dur(totals.userWaitS)} ${dim}(${pct(100 - globalActivePct)})${reset}`);
  console.log(`  Conversations: ${totals.conversations}`);
  console.log(`  Interactions:  ${totals.interactions}`);
}

function renderSession(m: SessionMetrics, isJson: boolean) {
  if (isJson) {
    console.log(JSON.stringify(m, null, 2));
    return;
  }

  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";

  console.log(`${bold}${m.name}${reset} ${dim}(${m.status})${reset}\n`);
  console.log(`  Duration:      ${dur(m.durationS)}`);
  console.log(`  Claude work:   ${dur(m.claudeWorkS)} ${dim}(${pct(m.activePct)})${reset}`);
  console.log(`  User wait:     ${dur(m.userWaitS)} ${dim}(${pct(100 - m.activePct)})${reset}`);
  console.log(`  Events:        ${m.eventCount}`);
  console.log(`  Conversations: ${m.conversationCount}`);
  console.log(`  Interactions:  ${m.interactionCount}`);
}

// --- Command ---

register("stats", async (args) => {
  const isJson = args.includes("--json");
  const filteredArgs = args.filter((a) => !a.startsWith("--"));
  const target = filteredArgs[0];

  // Global stats (no args)
  if (!target) {
    const rows = getAllSessions();
    const metrics = rows.map((r) =>
      getMetrics(r.session.id, r.session.slug, r.session.status)
    );
    renderGlobal(metrics, isJson);
    return;
  }

  // Per-session stats
  const resolved = resolveSessionByName(target);
  if (!resolved) {
    console.error(`Session not found: ${target}`);
    process.exit(1);
  }

  const m = getMetrics(resolved.session.id, resolved.slug, resolved.session.status);
  renderSession(m, isJson);
});
