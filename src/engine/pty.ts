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
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
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
