export interface TerminalAdapter {
  /** Terminal type identifier */
  type: string;
  /** Check if this terminal is available */
  detect(): boolean;
  /** Set a badge icon on the terminal tab/block */
  badge(icon: string, color: string, priority?: number, beep?: boolean): void;
  /** Clear the badge */
  clearBadge(): void;
  /** Show a desktop notification */
  notify(title: string, body: string): void;
}
