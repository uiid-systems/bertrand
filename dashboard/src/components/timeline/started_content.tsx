import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  Group,
  Stack,
  TableBody,
  TableCell,
  TableCellActions,
  TableContainer,
  TableRoot,
  TableRow,
  Text,
} from "@uiid/design-system";
import { Check, Copy, ExternalLink, FolderOpen } from "@uiid/icons";

import type { EventRow } from "../../api/types";
import { modelLabel } from "../../lib/format";

type StartedContentProps = {
  event: EventRow;
};

type GitMeta = {
  branch?: string;
  sha?: string;
  dirty?: boolean;
};

type Row = { field: string; value: ReactNode };

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      variant="ghost"
      shape="square"
      tooltip={copied ? "Copied!" : "Copy path"}
      disabled={copied}
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check color="green" /> : <Copy />}
    </Button>
  );
}

function shortId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.slice(0, 8);
}

function shortSha(sha: string | undefined): string | undefined {
  if (!sha) return undefined;
  return sha.slice(0, 7);
}

export function StartedContent({ event }: StartedContentProps) {
  const meta = event.meta as Record<string, unknown> | null;
  if (!meta) return null;

  const groupPath = meta.group_path as string | undefined;
  const sessionName = meta.session_name as string | undefined;
  const labels = (meta.labels as string[] | undefined) ?? [];
  const summary = meta.summary as string | null | undefined;

  const claudeId =
    (meta.claude_id as string | undefined) ?? event.conversationId ?? undefined;
  const model = modelLabel(meta.model as string | undefined);
  const claudeVersion = meta.claude_version as string | undefined;
  const id = shortId(claudeId);

  const git = (meta.git as GitMeta | undefined) ?? undefined;
  const branch = git?.branch;
  const sha = shortSha(git?.sha);
  const dirty = !!git?.dirty;
  const cwd = meta.cwd as string | undefined;

  const identityLabel = [groupPath, sessionName].filter(Boolean).join(" / ");

  const rows: Row[] = [];
  if (identityLabel) rows.push({ field: "Session", value: identityLabel });
  if (labels.length > 0)
    rows.push({ field: "Labels", value: labels.join(", ") });
  if (summary) rows.push({ field: "Summary", value: summary });
  if (model)
    rows.push({
      field: "Model",
      value: (
        <Badge color="orange" size="small">
          {model}
        </Badge>
      ),
    });
  if (claudeVersion)
    rows.push({
      field: "Version",
      value: (
        <Badge color="neutral" size="small">
          {claudeVersion}
        </Badge>
      ),
    });
  if (id)
    rows.push({
      field: "Claude ID",
      value: (
        <Badge color="neutral" size="small">
          {id}
        </Badge>
      ),
    });
  if (branch)
    rows.push({
      field: "Branch",
      value: (
        <Group gap={2} ay="center">
          <Badge color="neutral" size="small">
            {branch}
          </Badge>
          {sha && (
            <Badge color="neutral" size="small">
              {sha}
            </Badge>
          )}
          {dirty && (
            <Badge color="red" size="small">
              dirty
            </Badge>
          )}
        </Group>
      ),
    });
  if (cwd)
    rows.push({
      field: "CWD",
      value: (
        <Text family="mono" size={-1} color="neutral">
          {cwd}
        </Text>
      ),
    });

  if (rows.length === 0) return null;

  const isCwdRow = (row: Row) => row.field === "CWD";
  const onlyOnCwd = (button: React.ReactElement, row: Row) =>
    isCwdRow(row) ? button : <></>;

  const actions = {
    primary: [
      {
        icon: ExternalLink,
        tooltip: "Open in Cursor",
        onClick: (row: Row) => {
          if (!isCwdRow(row) || !cwd) return;
          window.open(`cursor://file/${encodeURI(cwd)}`, "_blank");
        },
        wrapper: onlyOnCwd,
      },
      {
        icon: FolderOpen,
        tooltip: "Open in Finder",
        onClick: (row: Row) => {
          if (!isCwdRow(row) || !cwd) return;
          void fetch("/api/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: cwd }),
          });
        },
        wrapper: onlyOnCwd,
      },
      {
        icon: Copy,
        tooltip: "Copy path",
        wrapper: (_button: React.ReactElement, row: Row) =>
          isCwdRow(row) && cwd ? <CopyButton text={cwd} /> : <></>,
      },
    ],
  };

  return (
    <Stack py={4} fullwidth>
      <Card trimmed fullwidth>
        <TableContainer>
          <TableRoot striped bordered>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.field}>
                  <TableCell>
                    <Text weight="bold">{row.field}</Text>
                  </TableCell>
                  <TableCell>{row.value}</TableCell>
                  <TableCellActions actions={actions} item={row} />
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        </TableContainer>
      </Card>
    </Stack>
  );
}
StartedContent.displayName = "StartedContent";
