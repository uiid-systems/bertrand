import { Text } from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";

type SessionLabelProps = {
  session: SessionWithCategory;
};

export const SessionLabel = ({ session: s }: SessionLabelProps) => (
  <Text
    title={`${s.categoryPath}/${s.session.slug}`}
    weight="semibold"
    size={-1}
    truncate
  >
    <Text render={<span />} shade="muted">
      {s.categoryPath}
    </Text>
    {`/${s.session.slug}`}
  </Text>
);
SessionLabel.displayName = "SessionLabel";
