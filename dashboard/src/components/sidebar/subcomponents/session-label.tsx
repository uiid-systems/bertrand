import { Link } from "@tanstack/react-router";
import { Text } from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";

type SessionLabelProps = {
  session: SessionWithCategory;
};

export const SessionLabel = ({ session: s }: SessionLabelProps) => (
  <Text
    style={{
      textOverflow: "ellipsis",
      overflow: "hidden",
      whiteSpace: "nowrap",
    }}
    render={
      <Link
        to="/$"
        params={{ _splat: `${s.categoryPath}/${s.session.slug}` }}
      />
    }
    size={-1}
  >
    {s.session.slug}
  </Text>
);
SessionLabel.displayName = "SessionLabel";
