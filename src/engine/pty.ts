/**
 * Thin wrapper over Bun's native PTY (`Bun.spawn`'s `terminal` option, POSIX
 * only, landed in Bun 1.3.5). One `data` callback is the single fan-out
 * point for output; `write`/`resize` are the single fan-in points for input
 * — local terminal and future remote consumers (browser) both just call
 * these, making them interchangeable. See docs/pty-wrapper.md.
 */
export interface PtyHandle {
  readonly pid: number;
  readonly exited: Promise<number>;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  kill(signal?: NodeJS.Signals | number): void;
}

export interface PtyDims {
  cols: number;
  rows: number;
}

/**
 * The conventional terminal grid, used before any viewer has reported a size.
 */
export const DEFAULT_DIMS: PtyDims = { cols: 80, rows: 24 };

/**
 * The size to give a PTY that several views are attached to: the smallest of
 * them per axis. This is tmux's smallest-attached-client rule — the larger view
 * gets unused margin, which is harmless, whereas the smaller one would be sent
 * a frame it has to truncate.
 *
 * Either input can be absent, and the two cases are mirrors of each other:
 * `claim` is null when no dashboard browser has taken sizing over, so the local
 * terminal's size stands unchanged; `local` is null for a dashboard-owned
 * session, where the server spawned the PTY and there is no terminal to take a
 * minimum against — the browser's claim is then the only input, and the grid is
 * exactly the panel's with no margin and no handover. With neither, nothing has
 * reported a size yet and the conventional 80×24 stands in.
 */
export function smallestDims(local: PtyDims | null, claim: PtyDims | null): PtyDims {
  if (!local) return claim ?? DEFAULT_DIMS;
  if (!claim) return local;
  return {
    cols: Math.min(local.cols, claim.cols),
    rows: Math.min(local.rows, claim.rows),
  };
}

export interface SpawnPtyOptions {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (chunk: Uint8Array) => void;
}

export function spawnPty(cmd: string[], opts: SpawnPtyOptions): PtyHandle {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    terminal: {
      cols: opts.cols ?? DEFAULT_DIMS.cols,
      rows: opts.rows ?? DEFAULT_DIMS.rows,
      data: (_terminal, data) => opts.onData(data),
    },
  });

  const terminal = proc.terminal;
  if (!terminal) {
    throw new Error("Bun did not attach a PTY (unsupported on this platform?)");
  }

  return {
    get pid() {
      return proc.pid;
    },
    exited: proc.exited,
    write(data) {
      terminal.write(data);
    },
    resize(cols, rows) {
      terminal.resize(cols, rows);
    },
    kill(signal) {
      proc.kill(signal as number | NodeJS.Signals | undefined);
    },
  };
}
