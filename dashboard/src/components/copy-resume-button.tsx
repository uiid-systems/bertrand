import { useState } from "react";

import { ToggleButton, type ToggleButtonProps } from "@uiid/design-system";
import { Check, Copy } from "@uiid/icons";

import type { SessionRow } from "../api/types";

type CopyResumeButtonProps = Omit<
  ToggleButtonProps,
  "pressed" | "onPressedChange" | "icon" | "children"
> & {
  session: SessionRow;
};

export const CopyResumeButton = ({
  session,
  size = "small",
  variant = "ghost",
  shape = "square",
  ...rest
}: CopyResumeButtonProps) => {
  const [copied, setCopied] = useState(false);

  if (session.status !== "paused") return null;

  function handlePressedChange(next: boolean) {
    if (!next) return;
    // The bare slug is exactly what `bertrand <slug>` resumes.
    void navigator.clipboard.writeText(session.slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClick(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <ToggleButton
      tooltip={copied ? "Copied!" : "Copy session path"}
      icon={{ unpressed: <Copy />, pressed: <Check /> }}
      onPressedChange={handlePressedChange}
      onClick={handleClick}
      size={size}
      variant={variant}
      shape={shape}
      pressed={copied}
      {...rest}
    />
  );
};
CopyResumeButton.displayName = "CopyResumeButton";
