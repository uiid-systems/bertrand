import { register, alias } from "@/cli/router";
import { getAllSessions, getSessionsByCategory } from "@/db/queries/sessions";
import { getCategoryByPath } from "@/db/queries/categories";
import { getSessionStats } from "@/db/queries/stats";
import { formatAgo, formatDuration } from "@/lib/format";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { applyProjectFlag, extractProjectFlag } from "@/lib/projects/cli-flag";

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
}

type SessionRow = ReturnType<typeof getAllSessions>[number];

function buildRows(sessions: SessionRow[]): ListRow[] {
  return sessions
    .sort((a, b) => new Date(b.session.updatedAt).getTime() - new Date(a.session.updatedAt).getTime())
    .map((row) => {
      const stats = getSessionStats(row.session.id);
      return {
        name: `${row.categoryPath}/${row.session.slug}`,
        status: row.session.status,
        updatedAt: row.session.updatedAt,
        conversations: stats?.conversationCount ?? 0,
        duration: stats?.durationS ? formatDuration(stats.durationS * 1000) : "-",
      };
    });
}

function renderTable(rows: ListRow[]) {
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const project = resolveActiveProject();
  console.log(`${dim}Project: ${project.slug} (${project.name})${reset}`);

  if (rows.length === 0) {
    console.log("No sessions found.");
    return;
  }

  const maxName = Math.max(...rows.map((r) => r.name.length), 4);

  // Header
  console.log(
    `${dim}${"  "} ${"NAME".padEnd(maxName)}  ${"STATUS".padEnd(10)}  ${"DURATION".padEnd(8)}  ${"CONVOS".padEnd(6)}  LAST ACTIVE${reset}`
  );

  for (const row of rows) {
    const dot = STATUS_DOTS[row.status] ?? "?";
    const statusText = row.status.padEnd(10);
    const dur = row.duration.padEnd(8);
    const convos = String(row.conversations).padEnd(6);
    const ago = formatAgo(row.updatedAt);
    console.log(`${dot} ${row.name.padEnd(maxName)}  ${statusText}  ${dur}  ${convos}  ${ago}`);
  }
}

function renderJson(rows: ListRow[]) {
  const project = resolveActiveProject();
  // Root stays an array so existing consumers parsing `list --json` as a
  // session list don't break. Project info rides on each row — redundant
  // when iterating, but lets a row tell you which project it came from
  // when read in isolation (the agent-query case).
  const data = rows.map((r) => ({
    name: r.name,
    status: r.status,
    duration: r.duration,
    conversations: r.conversations,
    updatedAt: r.updatedAt,
    project: { slug: project.slug, name: project.name },
  }));
  console.log(JSON.stringify(data, null, 2));
}

alias("ls", "list");

register("list", async (args) => {
  const { project: projectSlug, rest: argsWithoutProject } = extractProjectFlag(args);
  applyProjectFlag(projectSlug);

  const isJson = argsWithoutProject.includes("--json");
  const showAll = argsWithoutProject.includes("--all") || argsWithoutProject.includes("-a");
  const categoryFlag = argsWithoutProject.indexOf("--category");
  const categoryPath = categoryFlag !== -1 ? argsWithoutProject[categoryFlag + 1] : undefined;

  let sessionRows: SessionRow[];

  if (categoryPath) {
    const category = getCategoryByPath(categoryPath);
    if (!category) {
      console.error(`Category not found: ${categoryPath}`);
      process.exit(1);
    }
    const categorySessions = getSessionsByCategory(category.id);
    sessionRows = categorySessions.map((s) => ({ session: s, categoryPath: category.path }));

    if (!showAll) {
      sessionRows = sessionRows.filter((r) => r.session.status !== "archived");
    }
  } else {
    sessionRows = getAllSessions(showAll ? undefined : { excludeArchived: true });
  }

  const rows = buildRows(sessionRows);

  if (isJson) {
    renderJson(rows);
  } else {
    renderTable(rows);
  }
});
