import { Activity } from "react";
import { Link } from "@tanstack/react-router";
import { Badge, Button, Group, Text } from "@uiid/design-system";
import { ChartGanttIcon, FileDiffIcon, CaseSensitiveIcon } from "@uiid/icons";
import { TopBarWrapper } from "./topbar-wrapper";
import { ThemeToggle } from "../theme-toggle";

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

      <Group gap={3} ay="center" ml="auto">
        <Group gap={2} ay="center">
          <DevButton
            to="/"
            tooltip="Session timeline"
            icon={<ChartGanttIcon />}
          />

          <DevButton
            to="/dev/markdown"
            tooltip="Markdown viewer"
            icon={<CaseSensitiveIcon />}
          />

          <DevButton
            to="/dev/diff"
            tooltip="Diff viewer"
            icon={<FileDiffIcon />}
          />
        </Group>
        <ThemeToggle />
      </Group>
    </TopBarWrapper>
  );
};
TopBar.displayName = "TopBar";

const DevButton = ({
  to,
  tooltip,
  icon,
}: {
  to: string;
  tooltip: string;
  icon: React.ReactNode;
}) => {
  return (
    <Button
      render={<Link to={to} />}
      nativeButton={false}
      tooltip={tooltip}
      variant="subtle"
      size="small"
      shape="square"
    >
      {icon}
    </Button>
  );
};
