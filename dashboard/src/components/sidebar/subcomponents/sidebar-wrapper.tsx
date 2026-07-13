import { Stack, type StackProps } from "@uiid/design-system";

export type SidebarWrapperProps = StackProps;

export const SidebarWrapper = ({ children, ...props }: SidebarWrapperProps) => (
  <Stack
    data-slot="sidebar"
    render={<nav />}
    ax="stretch"
    fullwidth
    pb={64}
    {...props}
  >
    {children}
  </Stack>
);
SidebarWrapper.displayName = "SidebarWrapper";
