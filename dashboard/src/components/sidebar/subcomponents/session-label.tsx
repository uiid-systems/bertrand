import { Text } from "@uiid/design-system";
import type { SessionWithCategory } from "@/types";

type SessionLabelProps = {
  session: SessionWithCategory;
  /** Prefix the slug with the owning project. Set by the live zone, whose rows
   * span projects and so can't lean on a header for that context. */
  showProject?: boolean;
};

/**
 * The card's title: the session slug, optionally prefixed by its project. The
 * category is carried by the group header above the card, so repeating it on
 * every row was noise — it stays in the hover title, which is the only place
 * the full path is spelled out.
 */
export const SessionLabel = ({
  session: s,
  showProject = false,
}: SessionLabelProps) => {
  const path = `${s.categoryPath}/${s.session.slug}`;
  const project = showProject ? s.project : undefined;

  return (
    <Text
      title={project ? `${project.name}/${path}` : path}
      weight="semibold"
      size={-1}
      truncate
    >
      {project && (
        <Text render={<span />} size={-1} shade="muted">
          {`${project.name}/`}
        </Text>
      )}
      {s.session.slug}
    </Text>
  );
};
SessionLabel.displayName = "SessionLabel";
