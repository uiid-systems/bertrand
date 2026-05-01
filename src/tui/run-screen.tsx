/**
 * Subprocess entry point for TUI screens.
 *
 * Renders a Storm screen, collects the result, writes it to a temp file,
 * and exits. This ensures Storm is fully unloaded before Claude starts —
 * the parent process never imports Storm at all.
 *
 * Usage: bun run src/tui/run-screen.tsx <screen> <outputPath> [args...]
 */
import { writeFileSync } from "fs";
import { render } from "@orchetron/storm";

import { Launch } from "./screens/launch/index";
import type { LaunchSelection } from "./screens/launch/launch.types";
import { Exit, type ExitAction } from "./screens/Exit";
import { Resume, type ResumeSelection } from "./screens/Resume";

const [, , screen, outputPath, ...args] = process.argv;

if (!screen || !outputPath) {
  console.error("Usage: run-screen <screen> <outputPath> [args...]");
  process.exit(1);
}

let result: unknown;

switch (screen) {
  case "launch": {
    let selection: LaunchSelection = { type: "quit" };
    const app = render(
      <Launch onSelect={(s) => { selection = s; }} />,
      { alternateScreen: true, patchConsole: true },
    );
    await app.waitUntilExit();
    app.unmount();
    result = selection;
    break;
  }

  case "exit": {
    const sessionId = args[0];
    if (!sessionId) { console.error("exit requires sessionId"); process.exit(1); }
    let action: ExitAction = "save";
    const app = render(
      <Exit sessionId={sessionId} onAction={(a) => { action = a; }} />,
      { alternateScreen: true, patchConsole: true },
    );
    await app.waitUntilExit();
    app.unmount();
    result = action;
    break;
  }

  case "resume": {
    const sessionId = args[0];
    if (!sessionId) { console.error("resume requires sessionId"); process.exit(1); }
    let selection: ResumeSelection = { type: "back" };
    const app = render(
      <Resume sessionId={sessionId} onSelect={(s) => { selection = s; }} />,
      { alternateScreen: true, patchConsole: true },
    );
    await app.waitUntilExit();
    app.unmount();
    result = selection;
    break;
  }

  default:
    console.error(`Unknown screen: ${screen}`);
    process.exit(1);
}

writeFileSync(outputPath, JSON.stringify(result));
process.exit(0);
