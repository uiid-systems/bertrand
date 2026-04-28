import { Toggle, ToggleGroup } from "@uiid/design-system";
import { Monitor, Moon, Sun } from "@uiid/icons";

import { useTheme } from "../../lib/use-theme";

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      value={[theme]}
      onValueChange={(value) => {
        const next = value[0] as "light" | "dark" | "system";
        if (next) setTheme(next);
      }}
      size="sm"
    >
      <Toggle value="light" aria-label="Light mode">
        <Sun />
      </Toggle>
      <Toggle value="dark" aria-label="Dark mode">
        <Moon />
      </Toggle>
      <Toggle value="system" aria-label="System theme">
        <Monitor />
      </Toggle>
    </ToggleGroup>
  );
};
ThemeToggle.displayName = "ThemeToggle";
