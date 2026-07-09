import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression tests for the alt-screen first-paint fix.
 *
 * Background: some terminals drop the very first paint emitted after the
 * \x1b[?1049h alt-screen-enter sequence. Storm screens whose component
 * tree contains a useEffect (Launch → Picker → text-field.tsx) get a
 * microtask-boundary repaint scheduled automatically and accidentally
 * mask the bug. Screens without useEffect (notably Exit.tsx) stay blank
 * until the user hits a key.
 *
 * Fix in run-screen.tsx: after every render() call, invoke
 *   app.screen.invalidate()  — reset diff prev buffer for a full repaint
 *   app.requestRepaint()     — schedule via queueMicrotask
 * This forces a second paint after a microtask boundary, which matches
 * what those terminals respect.
 *
 * These tests guard against accidental removal of the pattern. They are
 * source-level (we don't try to render Storm in-process — that's an
 * integration concern), so they are intentionally brittle to refactors
 * that move the pattern; if the pattern moves, the test moves with it.
 */
const RUN_SCREEN_PATH = join(import.meta.dir, "run-screen.tsx");

describe("run-screen.tsx alt-screen first-paint workaround", () => {
  const src = readFileSync(RUN_SCREEN_PATH, "utf-8");

  test("every render() call site is followed by invalidate + requestRepaint", () => {
    const renderCalls = src.match(/const app = render\(/g) ?? [];
    const invalidateCalls = src.match(/app\.screen\.invalidate\(\)/g) ?? [];
    const repaintCalls = src.match(/app\.requestRepaint\(\)/g) ?? [];

    // One render() per screen (launch, project-picker, exit, resume).
    expect(renderCalls.length).toBeGreaterThanOrEqual(4);
    expect(invalidateCalls.length).toBe(renderCalls.length);
    expect(repaintCalls.length).toBe(renderCalls.length);
  });

  test("invalidate + requestRepaint occur before await waitUntilExit (not after)", () => {
    // If the repaint pattern is moved after waitUntilExit, the workaround
    // becomes a no-op — Storm has already torn down. Each screen's block
    // must have invalidate/requestRepaint preceding waitUntilExit.
    const blocks = src.split(/case "(launch|project-picker|exit|resume)":/);
    // blocks[0] is the preamble; blocks alternate as [name, body, name, body, ...]
    const screenBodies: string[] = [];
    for (let i = 2; i < blocks.length; i += 2) {
      screenBodies.push(blocks[i]!);
    }
    expect(screenBodies.length).toBeGreaterThanOrEqual(4);

    for (const body of screenBodies) {
      const invalidateIdx = body.indexOf("app.screen.invalidate()");
      const repaintIdx = body.indexOf("app.requestRepaint()");
      const waitIdx = body.indexOf("app.waitUntilExit()");
      expect(invalidateIdx).toBeGreaterThan(-1);
      expect(repaintIdx).toBeGreaterThan(-1);
      expect(waitIdx).toBeGreaterThan(-1);
      expect(invalidateIdx).toBeLessThan(waitIdx);
      expect(repaintIdx).toBeLessThan(waitIdx);
    }
  });

  test("a result file is always written — try/finally + writeResult() pattern", () => {
    // Guarding the always-write-result contract with the parent's runScreen.
    // Without this, signal-killed renders leave no file and the parent
    // reports a useless 'killed by SIGINT' error.
    expect(src).toMatch(/} finally {[^}]*writeResult\(\)/s);
    expect(src).toContain('process.on("SIGINT", writeResult)');
    expect(src).toContain('process.on("SIGTERM", writeResult)');
    expect(src).toContain('process.on("SIGHUP", writeResult)');
  });

  test("signal handlers do NOT call process.exit — Storm owns terminal cleanup", () => {
    // Storm's own signal handler runs next and does the alt-screen exit +
    // raw mode restore. If our handler exits early, the terminal stays
    // stuck. The handler should just call writeResult and return.
    const writeResultDef = src.match(/function writeResult\(\)[\s\S]*?^}/m);
    expect(writeResultDef).not.toBeNull();
    expect(writeResultDef![0]).not.toContain("process.exit");
  });
});
