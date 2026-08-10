import { useQuery } from "@tanstack/react-query";
import { SiCursor } from "@icons-pack/react-simple-icons";
import { Button, type ButtonProps } from "@uiid/design-system";
import { ExternalLinkIcon } from "@uiid/icons";

import { projectsQuery } from "../api/queries";
import type { SessionRow } from "../api/types";
import {
  type EditorId,
  editorFileUri,
  editorLabel,
  usePreferredEditor,
} from "../lib/editor";

/**
 * The editor's own mark, so the button says which editor it opens without
 * relying on its tooltip. Simple Icons ships no Visual Studio Code mark (its
 * only VSCode-family entry is VSCodium, a different product), so VS Code keeps
 * the generic open-link glyph rather than borrowing another project's logo.
 */
function EditorIcon({ editor }: { readonly editor: EditorId }) {
  return editor === "cursor" ? (
    <SiCursor size={13} />
  ) : (
    <ExternalLinkIcon size={13} />
  );
}

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
  variant = "ghost",
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
      <EditorIcon editor={editor} />
    </Button>
  );
};
OpenInEditorButton.displayName = "OpenInEditorButton";
