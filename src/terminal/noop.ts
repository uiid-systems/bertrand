import type { TerminalAdapter } from "./adapter.ts";

export class NoopAdapter implements TerminalAdapter {
  type = "noop" as const;

  detect(): boolean {
    return true; // Always available as fallback
  }

  badge(): void {}
  clearBadge(): void {}
  notify(): void {}
}
