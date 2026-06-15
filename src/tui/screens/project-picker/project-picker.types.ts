export type ProjectPickerSelection =
  | { type: "select"; slug: string }
  | { type: "create"; slug: string }
  | { type: "quit" };

export interface ProjectPickerProps {
  onSelect: (selection: ProjectPickerSelection) => void;
}
