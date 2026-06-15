import { spawn } from "child_process";
import { hasSyncConfig } from "@/sync/config";
import { isSyncEnabled } from "@/lib/config";

/**
 * Fire-and-forget `bertrand sync <op>` in a detached process.
 *
 * Lives in its own short-lived process so it survives the hook script
 * exiting and doesn't block the caller. Stderr is swallowed because the
 * user is in the middle of a session — we don't want sync chatter on top
 * of whatever the TUI/Claude is doing. Use `bertrand sync status` to see
 * whether it landed.
 */
function spawnSync(op: "push" | "pull") {
  if (!isSyncEnabled() || !hasSyncConfig()) return;
  const bin = process.argv[1] && process.argv[1].endsWith(".ts")
    ? process.execPath
    : "bertrand";
  const args =
    process.argv[1] && process.argv[1].endsWith(".ts")
      ? ["run", process.argv[1], "sync", op]
      : ["sync", op];
  const child = spawn(bin, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/** Called from the launch path before the TUI mounts. */
export function triggerBackgroundPull(): void {
  spawnSync("pull");
}

/** Called from engine/session.ts at the tail of finalizeSession. */
export function triggerBackgroundPush(): void {
  spawnSync("push");
}
