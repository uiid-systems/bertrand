import { describe, test, expect } from "bun:test";
import { DEFAULT_DIMS, smallestDims, spawnPty } from "./pty";

describe("smallestDims", () => {
  test("takes the smaller of each axis independently", () => {
    expect(smallestDims({ cols: 120, rows: 20 }, { cols: 80, rows: 40 })).toEqual({
      cols: 80,
      rows: 20,
    });
  });

  test("leaves the local terminal's size alone when no browser has claimed", () => {
    expect(smallestDims({ cols: 120, rows: 40 }, null)).toEqual({ cols: 120, rows: 40 });
  });

  // The dashboard-owned case: the server spawned the PTY, so there is no local
  // terminal to take a minimum against and the claim is honored outright.
  test("honors the claim outright when there is no local terminal", () => {
    expect(smallestDims(null, { cols: 200, rows: 60 })).toEqual({ cols: 200, rows: 60 });
  });

  test("falls back to the conventional grid when nothing has reported a size", () => {
    expect(smallestDims(null, null)).toEqual(DEFAULT_DIMS);
  });
});

describe("spawnPty", () => {
  test("round-trips data through the PTY", async () => {
    const chunks: string[] = [];
    const pty = spawnPty(["cat"], {
      onData: (chunk) => chunks.push(Buffer.from(chunk).toString()),
    });

    pty.write("hello pty\n");

    await new Promise((resolve) => setTimeout(resolve, 200));
    pty.kill();
    await pty.exited;

    expect(chunks.join("")).toContain("hello pty");
  });

  test("resolves `exited` with the process's exit code", async () => {
    const pty = spawnPty(["sh", "-c", "exit 7"], {
      onData: () => {},
    });

    expect(await pty.exited).toBe(7);
  });

  test("resize does not throw", async () => {
    const pty = spawnPty(["sleep", "1"], { onData: () => {} });
    expect(() => pty.resize(100, 40)).not.toThrow();
    pty.kill();
    await pty.exited;
  });
});
