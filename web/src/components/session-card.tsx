import { type AccordionItemData } from "@uiid/design-system";

import { LogDrawer } from "@/components/log-drawer";
import { LogTrigger } from "@/components/log-trigger";

import type { Session } from "@/lib/types";

export function sessionToAccordionItem(session: Session): AccordionItemData {
  return {
    value: session.session,
    trigger: <LogTrigger session={session} />,
    content: <LogDrawer sessionName={session.session} />,
  };
}
