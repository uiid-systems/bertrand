import { Stack, type StackProps } from "@uiid/design-system";

export type SidebarWrapperProps = StackProps;

export const SidebarWrapper = ({ children, ...props }: SidebarWrapperProps) => (
  <Stack
    data-slot="sidebar"
    render={<nav />}
    ax="stretch"
    fullwidth
    gap={4}
    p={4}
    {...props}
  >
    {children}
  </Stack>
);
SidebarWrapper.displayName = "SidebarWrapper";
