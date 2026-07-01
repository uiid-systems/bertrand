import {
  Button,
  Group,
  MenuRoot,
  MenuTrigger,
  MenuPortal,
  MenuPositioner,
  MenuPopup,
  MenuItem,
} from "@uiid/design-system";
import { MoreHorizontalIcon, CopyIcon } from "@uiid/icons";
import { useArchiveAction } from "../../../api/use-archive-action";
import type { SessionRow } from "../../../api/types";

type SessionRowActionsProps = {
  session: SessionRow;
  categoryPath: string;
};

export const SessionRowActions = ({
  session,
  categoryPath,
}: SessionRowActionsProps) => {
  const action = useArchiveAction(session);
  const { Icon } = action;
  const canCopyResume = session.status === "paused";
  const sessionPath = `${categoryPath}/${session.slug}`;

  return (
    <MenuRoot>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="xsmall"
            shape="square"
            aria-label="Session actions"
            style={{ marginLeft: "auto" }}
          >
            <MoreHorizontalIcon />
          </Button>
        }
      />
      <MenuPortal>
        <MenuPositioner side="right" align="start">
          <MenuPopup>
            <MenuItem
              disabled={action.disabled}
              onClick={action.onClick}
              render={<Group ay="center" gap={2} />}
            >
              <Icon size={14} />
              {action.label}
            </MenuItem>
            <MenuItem
              disabled={!canCopyResume}
              onClick={() => {
                void navigator.clipboard.writeText(sessionPath);
              }}
              render={<Group ay="center" gap={2} />}
            >
              <CopyIcon size={14} />
              Copy session path
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </MenuRoot>
  );
};
SessionRowActions.displayName = "SessionRowActions";
