import { Text } from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";

type SessionLabelProps = {
  session: SessionWithCategory;
};

export const SessionLabel = ({ session: s }: SessionLabelProps) => (
  <Text
    title={s.session.slug}
    size={-1}
    /** @todo: move `truncate` to text component */
    style={{
      textOverflow: "ellipsis",
      overflow: "hidden",
      whiteSpace: "nowrap",
    }}
  >
    {s.session.slug}
  </Text>
);
SessionLabel.displayName = "SessionLabel";
