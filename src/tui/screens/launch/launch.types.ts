export type LaunchSelection =
  /** No slug means "start unnamed" — the session is named at pause. */
  | { type: "create"; slug?: string }
  | { type: "pick"; sessionId: string }
  | { type: "quit" };

export interface LaunchProps {
  onSelect: (selection: LaunchSelection) => void;
}
