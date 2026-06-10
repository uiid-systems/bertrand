import { useState } from "react";

import { ToggleButton, type ToggleButtonProps } from "@uiid/design-system";
import { Check, Copy } from "@uiid/icons";

import type { SessionRow } from "../api/types";

type CopyResumeButtonProps = Omit<
  ToggleButtonProps,
  "pressed" | "onPressedChange" | "icon" | "children"
> & {
  session: SessionRow;
  groupPath: string;
};

export const CopyResumeButton = ({
  session,
  groupPath,
  size = "small",
  variant = "subtle",
  shape = "square",
  ...rest
}: CopyResumeButtonProps) => {
  const [copied, setCopied] = useState(false);

  if (session.status !== "paused") return null;

  const command = `bertrand resume ${groupPath}/${session.slug}`;

  return (
    <ToggleButton
      tooltip={copied ? "Copied!" : "Copy resume command"}
      size={size}
      variant={variant}
      shape={shape}
      pressed={copied}
      onPressedChange={(next) => {
        if (!next) return;
        void navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      icon={{
        unpressed: <Copy />,
        pressed: <Check color="green" />,
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      {...rest}
    />
  );
};
CopyResumeButton.displayName = "CopyResumeButton";
