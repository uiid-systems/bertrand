export type LaunchSelection =
  | { type: "create"; categoryPath: string; slug: string }
  | { type: "pick"; sessionId: string }
  | { type: "quit" };

export interface LaunchProps {
  onSelect: (selection: LaunchSelection) => void;
}
