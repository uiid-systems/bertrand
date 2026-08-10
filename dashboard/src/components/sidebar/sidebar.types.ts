import type { SessionWithCategory } from "../../api/types";

export type CategoryGroup = {
  key: string;
  label: string;
  sessions: SessionWithCategory[];
};
