import { register, alias } from "@/cli/router";
import { getAllSessions } from "@/db/queries/sessions";
import { getSessionStats } from "@/db/queries/stats";
import { formatAgo, formatDuration } from "@/lib/format";

const STATUS_DOTS: Record<string, string> = {
  active: "\x1b[32m●\x1b[0m",     // green
  waiting: "\x1b[33m●\x1b[0m",    // yellow
  paused: "\x1b[90m●\x1b[0m",     // gray
  archived: "\x1b[90m○\x1b[0m",   // gray hollow
};

interface ListRow {
  name: string;
  status: string;
  updatedAt: string;
  conversations: number;
  duration: string;
  /**
   * `owner/repo` the session ran in, or "-" when its cwd resolved to none.
   *
   * New to the listing, and it earns a column because one database now holds
   * every repo's sessions. The old `Project: <slug>` header answered this for
   * the whole table, since a table only ever showed one project's rows; there
   * is no per-table answer any more.
   */
  repo: string;
  /** The unit of work, `<repo>@<branch>`. Null when the cwd resolved to none. */
  group: string | null;
}

type SessionRow = ReturnType<typeof getAllSessions>[number];

function buildRows(sessions: SessionRow[]): ListRow[] {
  return sessions
    .sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime())
    .map((row) => {
      const stats = getSessionStats(row.session.id);
      return {
        name: row.session.slug,
        status: row.session.status,
        updatedAt: row.session.updatedAt,
        conversations: stats?.conversationCount ?? 0,
        duration: stats?.durationS ? formatDuration(stats.durationS * 1000) : "-",
        repo: row.session.repo ?? "-",
        group: row.session.groupKey,
      };
    });
}

function renderTable(rows: ListRow[]) {
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  if (rows.length === 0) {
    console.log("No sessions found.");
    return;
  }

  const maxName = Math.max(...rows.map((r) => r.name.length), 4);
  const maxRepo = Math.max(...rows.map((r) => r.repo.length), 4);

  // Header
  console.log(
    `${dim}${"  "} ${"NAME".padEnd(maxName)}  ${"REPO".padEnd(maxRepo)}  ${"STATUS".padEnd(10)}  ${"DURATION".padEnd(8)}  ${"CONVOS".padEnd(6)}  LAST ACTIVE${reset}`
  );

  for (const row of rows) {
    const dot = STATUS_DOTS[row.status] ?? "?";
    const statusText = row.status.padEnd(10);
    const dur = row.duration.padEnd(8);
    const convos = String(row.conversations).padEnd(6);
    const ago = formatAgo(row.updatedAt);
    console.log(
      `${dot} ${row.name.padEnd(maxName)}  ${row.repo.padEnd(maxRepo)}  ${statusText}  ${dur}  ${convos}  ${ago}`
    );
  }
}

function renderJson(rows: ListRow[]) {
  // Root stays an array so existing consumers parsing `list --json` as a
  // session list don't break. Where the session ran rides on each row —
  // redundant when iterating, but it lets a row read in isolation say which
  // repo it belongs to (the agent-query case). This replaces the old
  // `project: { slug, name }`, which said the same thing for every row in the
  // table and was wrong for most of them.
  const data = rows.map((r) => ({
    name: r.name,
    status: r.status,
    duration: r.duration,
    conversations: r.conversations,
    updatedAt: r.updatedAt,
    repo: r.repo === "-" ? null : r.repo,
    group: r.group,
  }));
  console.log(JSON.stringify(data, null, 2));
}

alias("ls", "list");

register("list", async (args) => {
  const isJson = args.includes("--json");
  const showAll = args.includes("--all") || args.includes("-a");

  const sessionRows = getAllSessions(showAll ? undefined : { excludeArchived: true });

  const rows = buildRows(sessionRows);

  if (isJson) {
    renderJson(rows);
  } else {
    renderTable(rows);
  }
});
