import { useState } from "react";
import {
  Collapsible,
  Group,
  Stack,
  Text,
  paletteColorStyles,
} from "@uiid/design-system";
import { ChevronDownIcon, ChevronRightIcon } from "@uiid/icons";

import type { EventRow } from "../../api/types";
import { eventLabel, eventTitle } from "../../lib/format";
import { DiffBlock } from "../diff/diff-block";

type EditEntry = { oldStr: string; newStr: string };

type PermissionDetail = {
  tool: string;
  detail: string;
  outcome: string;
  count: number;
  oldStr?: string;
  newStr?: string;
  edits?: EditEntry[];
};

const DIFF_PREVIEW_ROWS = 5;

function hasDiff(p: PermissionDetail): boolean {
  return Boolean(p.oldStr || p.newStr || (p.edits && p.edits.length > 0));
}

function DiffContent({ permission }: { permission: PermissionDetail }) {
  // Normalize MultiEdit (`edits[]`) and single-edit (`oldStr`/`newStr`)
  // into one list of hunks so they all land inside the same CodeBlock —
  // multiple edits to one file shouldn't render as N stacked blocks.
  const edits =
    permission.edits && permission.edits.length > 0
      ? permission.edits.map((e) => ({
          oldStr: e.oldStr ?? "",
          newStr: e.newStr ?? "",
        }))
      : [{ oldStr: permission.oldStr ?? "", newStr: permission.newStr ?? "" }];

  return (
    <DiffBlock
      edits={edits}
      filename={permission.detail}
      rows={DIFF_PREVIEW_ROWS}
      defaultExpanded={false}
    />
  );
}

function permissionTrigger(p: PermissionDetail): string {
  const prefix = p.count > 1 ? `${p.count}× ` : "";
  return p.detail ? `${prefix}${p.detail}` : `${prefix}${p.tool}`;
}

function PermissionLabel({ permission }: { permission: PermissionDetail }) {
  return (
    <Text size={-1} family="mono" shade="muted">
      {permissionTrigger(permission)}
    </Text>
  );
}

/**
 * The work summary is yellow — the hue the event catalog gives tool work — but
 * it sits inside a tinted card, so it takes `--palette-on-tint` via `.tint-text`
 * rather than Text's `color` prop, which resolves to the page-background step.
 * See the rule in globals.css.
 */
const WORK_LINE_CLASS = `${paletteColorStyles.yellow} tint-text`;

/**
 * Verb and noun per tool, so a run of calls reads as "read 3 files" instead of
 * the bare "3 tool calls" this used to summarize with. Tools outside the table
 * fall back to their own name ("used 2 Foo calls").
 */
const TOOL_PHRASING: Record<string, { verb: string; noun: string }> = {
  Read: { verb: "read", noun: "file" },
  NotebookRead: { verb: "read", noun: "notebook" },
  Bash: { verb: "ran", noun: "command" },
  Grep: { verb: "searched", noun: "pattern" },
  Glob: { verb: "matched", noun: "glob" },
  Edit: { verb: "edited", noun: "file" },
  MultiEdit: { verb: "edited", noun: "file" },
  Write: { verb: "wrote", noun: "file" },
  NotebookEdit: { verb: "edited", noun: "notebook" },
  WebFetch: { verb: "fetched", noun: "page" },
  WebSearch: { verb: "searched", noun: "query" },
  Task: { verb: "ran", noun: "agent" },
};

function phrasingFor(tool: string): { verb: string; noun: string } {
  return TOOL_PHRASING[tool] ?? { verb: "used", noun: `${tool || "tool"} call` };
}

/**
 * One line for everything a work event did, grouped by tool so repeated calls
 * fold into a count: "read 3 files · ran 2 commands". Entries are summed by
 * `count`, not tallied one apiece, because consecutive identical calls are
 * already merged upstream and carry their run length there.
 */
export function summarizeWork(permissions: PermissionDetail[]): string {
  const totals = new Map<
    string,
    { verb: string; noun: string; count: number }
  >();

  for (const p of permissions) {
    const { verb, noun } = phrasingFor(p.tool);
    const key = `${verb} ${noun}`;
    const entry = totals.get(key) ?? { verb, noun, count: 0 };
    entry.count += p.count ?? 1;
    totals.set(key, entry);
  }

  return [...totals.values()]
    .map(
      ({ verb, noun, count }) =>
        `${verb} ${count} ${count === 1 ? noun : `${noun}s`}`,
    )
    .join(" · ");
}

type WorkContentProps = {
  event: EventRow;
};

/** The tool calls a work event carries, or an empty list for anything else. */
export function workPermissions(event: EventRow): PermissionDetail[] {
  const meta = event.meta as Record<string, unknown> | null;
  const permissions = meta?.permissions as PermissionDetail[] | undefined;
  return permissions ?? [];
}

/**
 * Whether a work event has anything worth opening a line for — a diff to show,
 * or the file paths and commands a rolled-up count would otherwise hide.
 */
export function hasWorkDetail(event: EventRow): boolean {
  return workPermissions(event).some((p) => hasDiff(p) || Boolean(p.detail));
}

/**
 * The single line a work event shows. Its own summary wins when it has one
 * ("edited $.tsx (+4 -4)"), since that names the actual file and delta; only
 * when the event has nothing but the generic catalog label do we fall back to a
 * count rolled up from the calls themselves ("read 2 files"). Either way it is
 * one line, and it is the same line that acts as the disclosure trigger — the
 * count never repeats underneath the title it duplicates.
 */
export function workTitle(event: EventRow): string {
  const title = eventTitle(event);
  const permissions = workPermissions(event);
  if (permissions.length === 0) return title;
  return title === eventLabel(event.event)
    ? summarizeWork(permissions)
    : title;
}

/**
 * The revealed body of a work event: diffs as their own CodeBlocks (each with
 * its own built-in collapse), then the remaining calls as plain mono labels,
 * since a Bash or Grep entry has no diff to host its detail.
 *
 * This renders no summary line of its own. The line that toggles it lives with
 * the title — the card's for a top-level work event, {@link WorkContent}'s own
 * for a part folded inside an agent turn.
 */
export function WorkDetail({ event }: WorkContentProps) {
  const permissions = workPermissions(event);

  const diffPermissions = permissions.filter(hasDiff);
  const infoPermissions = permissions.filter(
    (p) => !hasDiff(p) && Boolean(p.detail),
  );
  // Calls with neither a diff nor a detail have nothing to show; rendering the
  // container anyway would leave an empty block padding out the card.
  if (diffPermissions.length === 0 && infoPermissions.length === 0) return null;

  return (
    <Stack data-slot="work-content" gap={2} fullwidth>
      {diffPermissions.map((p, i) => (
        <DiffContent key={`diff-${i}`} permission={p} />
      ))}
      {infoPermissions.map((p, i) => (
        <PermissionLabel key={`info-${i}`} permission={p} />
      ))}
    </Stack>
  );
}
WorkDetail.displayName = "WorkDetail";

/**
 * A work event as one self-contained line, for contexts with no card title to
 * hang the disclosure off — the parts folded inside a consolidated agent turn.
 * The line is the title; expanding it reveals {@link WorkDetail}. With nothing
 * to reveal it stays a plain line, so the row never grows a dead chevron.
 */
export function WorkContent({ event }: WorkContentProps) {
  const [open, setOpen] = useState(false);

  const permissions = workPermissions(event);
  if (permissions.length === 0) return null;

  const title = workTitle(event);

  if (!hasWorkDetail(event)) {
    return (
      <Text size={-1} weight="medium" className={WORK_LINE_CLASS}>
        {title}
      </Text>
    );
  }

  return (
    <Collapsible
      RootProps={{ open, onOpenChange: setOpen }}
      TriggerProps={{ nativeButton: false }}
      trigger={
        <Group gap={1} ay="center" style={{ cursor: "pointer" }}>
          {open ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )}
          <Text size={-1} weight="medium" className={WORK_LINE_CLASS}>
            {title}
          </Text>
        </Group>
      }
    >
      <Stack pt={2} fullwidth>
        <WorkDetail event={event} />
      </Stack>
    </Collapsible>
  );
}
WorkContent.displayName = "WorkContent";
