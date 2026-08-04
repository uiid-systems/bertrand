import { describe, test, expect } from "bun:test";
import { spawnPty } from "./pty";

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
