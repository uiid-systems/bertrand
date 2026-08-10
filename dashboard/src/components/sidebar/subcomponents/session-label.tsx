import { Text } from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";

type SessionLabelProps = {
  session: SessionWithCategory;
};

/**
 * The card's title: the session slug, and nothing else. Every row now sits
 * under a group header that names its category (project zone) or its project
 * (live zone), so repeating either on the card was noise. Both stay in the
 * hover title, which is the only place the full path is spelled out.
 */
export const SessionLabel = ({ session: s }: SessionLabelProps) => {
  const path = `${s.categoryPath}/${s.session.slug}`;

  return (
    <Text
      title={s.project ? `${s.project.name}/${path}` : path}
      weight="semibold"
      size={-1}
      truncate
    >
      {s.session.slug}
    </Text>
  );
};
SessionLabel.displayName = "SessionLabel";
