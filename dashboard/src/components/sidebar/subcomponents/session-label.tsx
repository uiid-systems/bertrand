import { Text } from "@uiid/design-system";
import type { SessionListRow } from "@/types";

type SessionLabelProps = {
  session: SessionListRow;
};

/**
 * The card's title: the session slug, and nothing else — the slug is the
 * session's whole identity. The project stays in the hover title, which is the
 * only place the full path is spelled out.
 */
export const SessionLabel = ({ session: s }: SessionLabelProps) => {
  const slug = s.session.slug;

  return (
    <Text
      title={s.project ? `${s.project.name}/${slug}` : slug}
      weight="semibold"
      size={-1}
      truncate
    >
      {slug}
    </Text>
  );
};
SessionLabel.displayName = "SessionLabel";
