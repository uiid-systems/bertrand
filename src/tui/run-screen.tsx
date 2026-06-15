/**
 * Subprocess entry point for TUI screens.
 *
 * Renders a Storm screen, collects the result, writes it to a temp file,
 * and exits. This ensures Storm is fully unloaded before Claude starts —
 * the parent process never imports Storm at all.
 *
 * Robustness contract with the parent (tui/app.tsx::runScreen):
 *   - The result file is ALWAYS written before exit, even on signal /
 *     uncaught exception. Each screen has a default result (matching what
 *     the parent expects when the user cancels), and a try/finally +
 *     pre-cleanup signal handlers ensure it lands.
 *   - Terminal restoration (alt-screen exit, raw mode, cursor visibility)
 *     is owned by Storm. Our signal handlers run BEFORE Storm's because we
 *     register them earlier in this file; we only write the result file
 *     and return — Storm's handler then runs cleanup + re-raises the
 *     signal for default termination. Calling process.exit() from our
 *     handler would skip Storm's cleanup and leave the terminal stuck.
 *
 * Usage: bun run src/tui/run-screen.tsx <screen> <outputPath> [args...]
 */
import { writeFileSync, appendFileSync } from "fs";
import { render } from "@orchetron/storm";

import { Launch } from "./screens/launch/index";
import type { LaunchSelection } from "./screens/launch/launch.types";
import { Exit, type ExitAction } from "./screens/Exit";
import { Resume, type ResumeSelection } from "./screens/Resume";
import { ProjectPicker } from "./screens/project-picker/index";
import type { ProjectPickerSelection } from "./screens/project-picker/project-picker.types";

const [, , screen, outputPath, ...args] = process.argv;

if (!screen || !outputPath) {
  console.error("Usage: run-screen <screen> <outputPath> [args...]");
  process.exit(1);
}

// Pin the narrowed value into a definitely-string const — TypeScript's
// narrowing from the early-exit above doesn't propagate into closures
// (writeResult, signal handlers).
const RESULT_PATH: string = outputPath;

/**
 * Phase-marker instrumentation, gated on BERTRAND_DEBUG_TUI=<file-path>.
 * Logs to a file (not stderr) so output doesn't fight with alt-screen.
 * Used to diagnose terminal-rendering issues (e.g. Warp blank-screen).
 * Each line: <elapsed-ms> <phase> <detail?>
 */
const DEBUG_PATH = process.env.BERTRAND_DEBUG_TUI || null;
const START_HR = process.hrtime.bigint();
function phase(name: string, detail?: string): void {
  if (!DEBUG_PATH) return;
  const elapsedMs = Number(process.hrtime.bigint() - START_HR) / 1_000_000;
  const line = `${elapsedMs.toFixed(2).padStart(8)}ms  ${name}${detail ? "  " + detail : ""}\n`;
  try {
    appendFileSync(DEBUG_PATH, line);
  } catch {
    // best-effort
  }
}

phase("spawn", `screen=${screen} pid=${process.pid} isTTY=${process.stdout.isTTY ?? "?"} term=${process.env.TERM_PROGRAM || process.env.TERM || "?"}`);

let result: unknown;
let resultWritten = false;

function writeResult(): void {
  if (resultWritten) return;
  resultWritten = true;
  try {
    writeFileSync(RESULT_PATH, JSON.stringify(result));
  } catch {
    // Parent surfaces a clear error when the file is missing.
  }
}

// Register BEFORE Storm's render() so we fire first on signal/exception.
// We deliberately do not exit or reset terminal state — Storm's own handler
// runs next and owns terminal cleanup + signal propagation.
process.on("SIGINT", writeResult);
process.on("SIGTERM", writeResult);
process.on("SIGHUP", writeResult);
process.on("uncaughtException", writeResult);
process.on("unhandledRejection", writeResult);

let renderCount = 0;
const onRender = (m: { cellsChanged: number; renderTime: number }): void => {
  renderCount++;
  phase(`paint #${renderCount}`, `cells=${m.cellsChanged} took=${m.renderTime.toFixed(2)}ms`);
};

try {
  switch (screen) {
    case "launch": {
      let selection: LaunchSelection = { type: "quit" };
      result = selection;
      phase("render() pre");
      const app = render(
        <Launch
          onSelect={(s) => {
            selection = s;
            result = selection;
          }}
        />,
        { alternateScreen: true, patchConsole: true, onRender },
      );
      phase("render() post");
      // Warp (and likely any terminal with strict alt-screen activation
      // semantics) drops the very first paint emitted after \x1b[?1049h.
      // Force a second paint with a microtask boundary between it and the
      // initial commit — `invalidate()` resets the diff's prev buffer so
      // the upcoming repaint outputs the full content, and
      // `requestRepaint()` schedules via `queueMicrotask`, which is the
      // same path React useEffect takes (and the reason Launch/Picker
      // accidentally work — text-field.tsx's useEffects happen to trigger
      // a quick paint #2). Exit.tsx has no useEffect, which is why the
      // bug surfaces only there. Making the second paint explicit removes
      // the dependency on which components happen to be in the tree.
      app.screen.invalidate();
      app.requestRepaint();
      phase("post-mount invalidate+requestRepaint");
      await app.waitUntilExit();
      phase("waitUntilExit returned");
      app.unmount();
      phase("unmount done");
      result = selection;
      break;
    }

    case "project-picker": {
      let selection: ProjectPickerSelection = { type: "quit" };
      result = selection;
      phase("render() pre");
      const app = render(
        <ProjectPicker
          onSelect={(s) => {
            selection = s;
            result = selection;
          }}
        />,
        { alternateScreen: true, patchConsole: true, onRender },
      );
      phase("render() post");
      // Warp (and likely any terminal with strict alt-screen activation
      // semantics) drops the very first paint emitted after \x1b[?1049h.
      // Force a second paint with a microtask boundary between it and the
      // initial commit — `invalidate()` resets the diff's prev buffer so
      // the upcoming repaint outputs the full content, and
      // `requestRepaint()` schedules via `queueMicrotask`, which is the
      // same path React useEffect takes (and the reason Launch/Picker
      // accidentally work — text-field.tsx's useEffects happen to trigger
      // a quick paint #2). Exit.tsx has no useEffect, which is why the
      // bug surfaces only there. Making the second paint explicit removes
      // the dependency on which components happen to be in the tree.
      app.screen.invalidate();
      app.requestRepaint();
      phase("post-mount invalidate+requestRepaint");
      await app.waitUntilExit();
      phase("waitUntilExit returned");
      app.unmount();
      phase("unmount done");
      result = selection;
      break;
    }

    case "exit": {
      const sessionId = args[0];
      if (!sessionId) {
        console.error("exit requires sessionId");
        process.exit(1);
      }
      let action: ExitAction = "save";
      result = action;
      phase("render() pre");
      const app = render(
        <Exit
          sessionId={sessionId}
          onAction={(a) => {
            action = a;
            result = action;
          }}
        />,
        { alternateScreen: true, patchConsole: true, onRender },
      );
      phase("render() post");
      // Warp (and likely any terminal with strict alt-screen activation
      // semantics) drops the very first paint emitted after \x1b[?1049h.
      // Force a second paint with a microtask boundary between it and the
      // initial commit — `invalidate()` resets the diff's prev buffer so
      // the upcoming repaint outputs the full content, and
      // `requestRepaint()` schedules via `queueMicrotask`, which is the
      // same path React useEffect takes (and the reason Launch/Picker
      // accidentally work — text-field.tsx's useEffects happen to trigger
      // a quick paint #2). Exit.tsx has no useEffect, which is why the
      // bug surfaces only there. Making the second paint explicit removes
      // the dependency on which components happen to be in the tree.
      app.screen.invalidate();
      app.requestRepaint();
      phase("post-mount invalidate+requestRepaint");
      await app.waitUntilExit();
      phase("waitUntilExit returned");
      app.unmount();
      phase("unmount done");
      result = action;
      break;
    }

    case "resume": {
      const sessionId = args[0];
      if (!sessionId) {
        console.error("resume requires sessionId");
        process.exit(1);
      }
      let selection: ResumeSelection = { type: "back" };
      result = selection;
      phase("render() pre");
      const app = render(
        <Resume
          sessionId={sessionId}
          onSelect={(s) => {
            selection = s;
            result = selection;
          }}
        />,
        { alternateScreen: true, patchConsole: true, onRender },
      );
      phase("render() post");
      // Warp (and likely any terminal with strict alt-screen activation
      // semantics) drops the very first paint emitted after \x1b[?1049h.
      // Force a second paint with a microtask boundary between it and the
      // initial commit — `invalidate()` resets the diff's prev buffer so
      // the upcoming repaint outputs the full content, and
      // `requestRepaint()` schedules via `queueMicrotask`, which is the
      // same path React useEffect takes (and the reason Launch/Picker
      // accidentally work — text-field.tsx's useEffects happen to trigger
      // a quick paint #2). Exit.tsx has no useEffect, which is why the
      // bug surfaces only there. Making the second paint explicit removes
      // the dependency on which components happen to be in the tree.
      app.screen.invalidate();
      app.requestRepaint();
      phase("post-mount invalidate+requestRepaint");
      await app.waitUntilExit();
      phase("waitUntilExit returned");
      app.unmount();
      phase("unmount done");
      result = selection;
      break;
    }

    default:
      console.error(`Unknown screen: ${screen}`);
      process.exit(1);
  }

  writeResult();
  phase("result written");
} finally {
  // Idempotent — no-op on the happy path, safety net on exceptions.
  writeResult();
  phase("finally complete");
}

process.exit(0);
