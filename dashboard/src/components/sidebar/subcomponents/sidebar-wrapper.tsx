import { Stack, type StackProps } from "@uiid/design-system";

export type SidebarWrapperProps = StackProps;

export const SidebarWrapper = ({ children, ...props }: SidebarWrapperProps) => (
  <Stack
    data-slot="sidebar"
    render={<nav />}
    ax="stretch"
    gap={2}
    p={2}
    pb={64}
    fullwidth
    {...props}
  >
    {children}
  </Stack>
);
SidebarWrapper.displayName = "SidebarWrapper";
