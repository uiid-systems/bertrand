import { useQuery } from "@tanstack/react-query";
import { Button, type ButtonProps } from "@uiid/design-system";
import { ExternalLinkIcon } from "@uiid/icons";

import { projectsQuery } from "../api/queries";
import type { SessionRow } from "../api/types";
import {
  editorFileUri,
  editorLabel,
  usePreferredEditor,
} from "../lib/editor";

type OpenInEditorButtonProps = Omit<ButtonProps, "render" | "children"> & {
  session: SessionRow;
  /**
   * Which project the session belongs to. Omitted for single-project reads,
   * where the registry's active project *is* the session's project — the same
   * fallback the breadcrumb's project name uses.
   */
  projectSlug?: string;
};

/**
 * Open a session's code in the preferred local editor.
 *
 * Which directory that means is a property of the session, not of the button:
 * a session working in a worktree opens its checkout, and one working directly
 * on the repo opens the project's own checkout. Callers pass the session and
 * get the right target either way, so no surface has to know the rule.
 *
 * The project path comes from its repo binding, which is the only place
 * bertrand records where a project lives on this machine. An unbound project
 * therefore has no directory to offer — the button stays visible and disabled,
 * naming the missing binding rather than vanishing, since "there is nothing to
 * open here yet" is worth saying in place.
 */
export const OpenInEditorButton = ({
  session,
  projectSlug,
  size = "small",
  variant = "subtle",
  shape = "square",
  ...rest
}: OpenInEditorButtonProps) => {
  const { data: projects = [] } = useQuery(projectsQuery);
  const [editor] = usePreferredEditor();

  const project = projectSlug
    ? projects.find((p) => p.slug === projectSlug)
    : projects.find((p) => p.active);

  // A worktree is where the session's work actually is, so it wins whenever
  // one is recorded; the field is nulled when a worktree is removed, which is
  // what makes it safe to trust here.
  const worktreePath = session.worktreePath;
  const target = worktreePath ?? project?.repo?.path ?? null;

  const label = worktreePath
    ? `Open worktree in ${editorLabel(editor)}`
    : `Open project in ${editorLabel(editor)}`;

  return (
    <Button
      size={size}
      variant={variant}
      shape={shape}
      disabled={!target}
      aria-label={label}
      tooltip={
        target ? label : "No repo attached to this project — nothing to open"
      }
      // Stays a real <button> without a path — an anchor ignores `disabled`
      // and would navigate to a dead file URI.
      render={target ? <a href={editorFileUri(editor, target)} /> : undefined}
      {...rest}
    >
      <ExternalLinkIcon size={13} />
    </Button>
  );
};
OpenInEditorButton.displayName = "OpenInEditorButton";
