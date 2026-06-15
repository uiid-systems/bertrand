export type StartupSelection =
  | { type: "quit" }
  | {
      type: "create";
      projectSlug: string;
      categoryPath: string;
      slug: string;
    }
  | { type: "pick"; projectSlug: string; sessionId: string };

export interface StartupProps {
  /**
   * True when the parent has decided to bypass the project picker (e.g.
   * single registered project + no `BERTRAND_PROJECT` override). The active
   * project is already correct, so we mount Launch directly.
   */
  skipProjectPicker: boolean;
  /** Resolved active-project slug — required to label the launch result. */
  initialProjectSlug: string;
  onSelect: (selection: StartupSelection) => void;
}
