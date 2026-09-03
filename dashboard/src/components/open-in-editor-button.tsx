import { SiCursor } from "@icons-pack/react-simple-icons";
import { Button, type ButtonProps } from "@uiid/design-system";
import { ExternalLinkIcon } from "@uiid/icons";

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
};

/**
 * Open a session's code in the preferred local editor.
 *
 * The directory is the session's own — `worktreeRoot`, the git worktree its cwd
 * resolved to at start, falling back to the repo's main checkout. This used to
 * come from the *project's* repo binding, which was a path a human typed once
 * and which frequently named a different checkout than the session had ever
 * run in: open a session that worked in a linked worktree and you landed in the
 * main checkout, on someone else's branch. The session now records where it
 * actually was, so there is nothing to bind and nothing to get wrong.
 *
 * A session outside git has no directory to offer, and neither does one whose
 * worktree has since been torn down — but the fallback covers the common case
 * of that, since the main checkout outlives its worktrees. The button stays
 * visible and disabled rather than vanishing: "there is nothing to open here"
 * is worth saying in place.
 */
export const OpenInEditorButton = ({
  session,
  size = "small",
  variant = "ghost",
  shape = "square",
  ...rest
}: OpenInEditorButtonProps) => {
  const [editor] = usePreferredEditor();

  const target = session.worktreeRoot ?? session.mainCheckout ?? null;
  const label = `Open ${target ?? "session"} in ${editorLabel(editor)}`;

  return (
    <Button
      size={size}
      variant={variant}
      shape={shape}
      disabled={!target}
      aria-label={label}
      tooltip={
        target
          ? label
          : "This session didn't run in a git repo — no directory recorded"
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
