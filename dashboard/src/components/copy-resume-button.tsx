import { useState } from "react";

import { ToggleButton, type ToggleButtonProps } from "@uiid/design-system";
import { Check, Copy } from "@uiid/icons";

import type { SessionRow } from "../api/types";

type CopyResumeButtonProps = Omit<
  ToggleButtonProps,
  "pressed" | "onPressedChange" | "icon" | "children"
> & {
  session: SessionRow;
  categoryPath: string;
};

export const CopyResumeButton = ({
  session,
  categoryPath,
  size = "small",
  variant = "subtle",
  shape = "square",
  ...rest
}: CopyResumeButtonProps) => {
  const [copied, setCopied] = useState(false);

  if (session.status !== "paused") return null;

  const sessionPath = `${categoryPath}/${session.slug}`;

  return (
    <ToggleButton
      tooltip={copied ? "Copied!" : "Copy session path"}
      size={size}
      variant={variant}
      shape={shape}
      pressed={copied}
      style={{ textWrap: "nowrap" }}
      onPressedChange={(next) => {
        if (!next) return;
        void navigator.clipboard.writeText(sessionPath);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      icon={{
        unpressed: <Copy />,
        pressed: <Check color="green" />,
      }}
      text={{
        pressed: "Copied!",
        unpressed: "Copy path",
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
