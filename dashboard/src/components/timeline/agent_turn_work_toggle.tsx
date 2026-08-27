import { ToggleButton } from "@uiid/design-system";
import { EyeIcon, EyeOffIcon } from "@uiid/icons";

import { useToolWorkVisible } from "./use-tool-work";

/**
 * The eye in an agent-turn card's header, beside the tool/read counts: it drops
 * the tool work out of every turn card so the agent's prose reads as one reply.
 * It sits next to the counts because those counts are what stays behind — the
 * header still says what the turn did, the body just stops interleaving it.
 *
 * Pressed (eye open) is the timeline's original behaviour, so the affordance
 * reads as "you are seeing the work" rather than as a filter being applied.
 * Backed by {@link useToolWorkVisible}, which is one shared preference: pressing
 * this on any card quiets them all.
 */
export const AgentTurnWorkToggle = () => {
  const { visible, setVisible } = useToolWorkVisible();
  const label = visible ? "Hide tool work" : "Show tool work";

  return (
    <ToggleButton
      pressed={visible}
      onPressedChange={setVisible}
      size="xsmall"
      variant="ghost"
      shape="square"
      aria-label={label}
      tooltip={label}
      icon={{
        pressed: <EyeIcon size={13} />,
        unpressed: <EyeOffIcon size={13} />,
      }}
    />
  );
};
AgentTurnWorkToggle.displayName = "AgentTurnWorkToggle";
