import { Link } from "@tanstack/react-router";
import { Button, Group, Text } from "@uiid/design-system";
import { FileDiffIcon, CaseSensitiveIcon } from "@uiid/icons";
import { TopBarWrapper } from "./topbar-wrapper";
import { ThemeToggle } from "../theme-toggle";
import { NotificationToggle } from "../notification-toggle";

export const TopBar = () => {
  return (
    <TopBarWrapper>
      <Text size={2} weight="bold" mr={4}>
        bertrand
      </Text>
      <Text render={<Link to="/">Home</Link>} size={-1} weight="medium" />
      <Text
        render={<Link to="/sessions">Sessions</Link>}
        size={-1}
        weight="medium"
      />
      <Text
        render={<Link to="/worktrees">Worktrees</Link>}
        size={-1}
        weight="medium"
      />

      <Group gap={3} ay="center" ml="auto">
        <Group gap={2} ay="center">
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
        <NotificationToggle />
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
    >
      {icon}
    </Button>
  );
};
