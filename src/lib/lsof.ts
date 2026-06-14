import { execFileSync } from "child_process";

export type Holder = { pid: number; command: string };

/**
 * Use `lsof` to find PIDs holding the given path open. macOS / Linux only;
 * absent on Windows but that's not a target. Excludes our own PID so a
 * shell that opened the file briefly for a stat doesn't block us.
 *
 * Uses `execFileSync` with array args (not `execSync` with a shell string)
 * so the path is passed to lsof verbatim without any shell-quoting puzzle.
 *
 * Two known false-negatives by design: (1) when `lsof` isn't on PATH, this
 * returns `[]` — callers that *require* a confident answer should treat
 * absence of holders as "could not check, may be held"; (2) when no holder
 * exists, `lsof` exits non-zero and we swallow the error.
 */
export function findHolders(path: string): Holder[] {
  try {
    const out = execFileSync("lsof", ["-F", "pcn", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const holders: Holder[] = [];
    let pid = 0;
    let command = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("c")) command = line.slice(1);
      else if (line.startsWith("n")) {
        if (pid && pid !== process.pid && command) {
          holders.push({ pid, command });
        }
      }
    }
    return holders;
  } catch {
    return [];
  }
}
