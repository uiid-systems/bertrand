import { Activity } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Text } from "@uiid/design-system";
import { TopBarWrapper } from "./topbar-wrapper";

type TopBarProps = {
  sessionCount?: number;
};

export const TopBar = ({ sessionCount }: TopBarProps) => {
  return (
    <TopBarWrapper>
      <Text size={2} weight="bold">
        bertrand
      </Text>

      <Activity mode={sessionCount ? "visible" : "hidden"}>
        <Badge color="blue">{sessionCount} session(s)</Badge>
      </Activity>
    </TopBarWrapper>
  );
};
TopBar.displayName = "TopBar";
