import { type AccordionItemData } from "@uiid/design-system";

import { LogDrawer } from "@/components/log-drawer";
import { LogTrigger } from "@/components/log-trigger";

import type { Session, Options } from "@/lib/types";

export function sessionToAccordionItem(
  session: Session,
  options?: Options,
): AccordionItemData {
  return {
    value: session.session,
    trigger: <LogTrigger session={session} options={options} />,
    content: <LogDrawer sessionName={session.session} />,
  };
}
