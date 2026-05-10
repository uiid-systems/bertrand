import { useCallback } from "react";

import { Box, useTui } from "@orchetron/storm";

import { AppDetails, Logo } from "@/tui/components";

import type { LaunchSelection, LaunchProps } from "./launch.types";
import { CreateScreen } from "./create-screen";

export function Launch({ onSelect }: LaunchProps) {
  const { exit } = useTui();

  const select = useCallback(
    (selection: LaunchSelection) => {
      onSelect(selection);
      exit();
    },
    [onSelect, exit],
  );

  return (
    <Box flexDirection="column" paddingY={1} gap={1}>
      <Box marginX={1}>
        <Logo />
      </Box>

      <Box flexDirection="column" marginX={2} gap={1}>
        <AppDetails />

        <CreateScreen
          isFocused
          onSubmit={(payload) => select({ type: "create", ...payload })}
          onQuit={() => select({ type: "quit" })}
        />
      </Box>
    </Box>
  );
}
