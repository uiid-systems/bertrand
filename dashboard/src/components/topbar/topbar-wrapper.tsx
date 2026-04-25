import { Group, type GroupProps } from "@uiid/design-system";

type TopBarWrapperProps = GroupProps;

export const TopBarWrapper = ({ children, ...props }: TopBarWrapperProps) => (
  <Group
    data-slot="top-bar-wrapper"
    fullwidth
    ay="center"
    p={4}
    gap={4}
    bb={1}
    style={{
      position: "sticky",
      top: 0,
      backgroundColor: "var(--shade-background)",
      zIndex: 1,
      ...props.style,
    }}
    {...props}
  >
    {children}
  </Group>
);
TopBarWrapper.displayName = "TopBarWrapper";
