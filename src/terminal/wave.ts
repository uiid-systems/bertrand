import { execSync } from "child_process";
import type { TerminalAdapter } from "./adapter";

export class WaveAdapter implements TerminalAdapter {
  type = "wave" as const;

  detect(): boolean {
    try {
      execSync("which wsh", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  badge(icon: string, color: string, priority = 10, beep = false): void {
    try {
      const args = ["badge", icon, "--color", color, "--priority", String(priority)];
      if (beep) args.push("--beep");
      execSync(`wsh ${args.join(" ")}`, { stdio: "ignore" });
    } catch {
      // Silently fail — terminal may not support badges
    }
  }

  clearBadge(): void {
    try {
      execSync("wsh badge --clear", { stdio: "ignore" });
    } catch {
      // Silently fail
    }
  }

  notify(title: string, body: string): void {
    try {
      execSync(`wsh notify -t ${JSON.stringify(title)} ${JSON.stringify(body)}`, { stdio: "ignore" });
    } catch {
      // Silently fail
    }
  }
}
