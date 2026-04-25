import { useSecondarySidebarContent } from "../../lib/secondary-sidebar-context";
import {
  SidebarWrapper,
  type SidebarWrapperProps,
} from "../sidebar/sidebar-wrapper";

export const SecondarySidebar = (
  props: Omit<SidebarWrapperProps, "children">,
) => {
  const content = useSecondarySidebarContent();

  return (
    <SidebarWrapper data-slot="secondary-sidebar" {...props}>
      {content}
    </SidebarWrapper>
  );
};
SecondarySidebar.displayName = "SecondarySidebar";
