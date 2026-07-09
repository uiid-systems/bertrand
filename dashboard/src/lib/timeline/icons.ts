import type { Icon } from "@uiid/icons"
import {
  CircleCheckIcon,
  CircleDotIcon,
  CircleHelpIcon,
  CircleXIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlayIcon,
  SparklesIcon,
  TerminalIcon,
  WrenchIcon,
} from "@uiid/icons"
import type { KnownEvent } from "./categories"

/**
 * Event → icon mapping. Kept out of `./categories` so the pure timeline logic
 * (segments, transforms) and its unit tests never import `@uiid/icons` — a
 * React/UI package that isn't installed in the root `bun test` environment.
 * Typed as `Record<KnownEvent, Icon>` so the compiler flags any drift from the
 * catalog in `./categories`.
 */
const EVENT_ICONS: Record<KnownEvent, Icon> = {
  "claude.started": PlayIcon,
  "claude.ended": CircleCheckIcon,
  "claude.discarded": CircleXIcon,
  "session.waiting": CircleHelpIcon,
  "session.answered": MessagesSquareIcon,
  "user.prompt": MessageSquareIcon,
  "tool.work": WrenchIcon,
  "tool.applied": PencilIcon,
  "tool.used": TerminalIcon,
  "assistant.message": SparklesIcon,
}

const DEFAULT_ICON: Icon = CircleDotIcon

export function iconOf(event: string): Icon {
  return EVENT_ICONS[event as KnownEvent] ?? DEFAULT_ICON
}
