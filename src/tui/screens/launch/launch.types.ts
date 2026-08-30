export type LaunchSelection =
  | { type: "create"; slug: string }
  | { type: "pick"; sessionId: string }
  | { type: "quit" };

export interface LaunchProps {
  onSelect: (selection: LaunchSelection) => void;
}
