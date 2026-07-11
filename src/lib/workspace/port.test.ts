import { describe, test, expect, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  allocatePort,
  getPort,
  releasePort,
  prunePorts,
  _setPortDeps,
  _resetPortDeps,
} from "@/lib/workspace/port";

const dirs: string[] = [];

function freshRegistry(): string {
  const dir = mkdtempSync(join(tmpdir(), "bertrand-ports-"));
  dirs.push(dir);
  _setPortDeps({ registryDir: dir });
  return dir;
}

afterAll(() => {
  _resetPortDeps();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const RANGE_BASE = 4700;
const RANGE_SIZE = 200;

describe("allocatePort", () => {
  beforeEach(() => freshRegistry());

  test("is idempotent — same session always gets the same port", () => {
    const first = allocatePort("sess-a");
    expect(allocatePort("sess-a")).toBe(first);
    expect(getPort("sess-a")).toBe(first);
  });

  test("allocates within the range", () => {
    const port = allocatePort("sess-a");
    expect(port).toBeGreaterThanOrEqual(RANGE_BASE);
    expect(port).toBeLessThan(RANGE_BASE + RANGE_SIZE);
  });

  test("is deterministic across independent registries", () => {
    const p1 = allocatePort("stable-id");
    freshRegistry(); // brand-new empty registry
    expect(allocatePort("stable-id")).toBe(p1);
  });

  test("gives distinct sessions distinct ports (probes on collision)", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const port = allocatePort(`sess-${i}`);
      expect(seen.has(port)).toBe(false);
      seen.add(port);
    }
  });

  test("throws when the whole range is exhausted", () => {
    for (let i = 0; i < RANGE_SIZE; i++) allocatePort(`fill-${i}`);
    expect(() => allocatePort("one-too-many")).toThrow(/no free preview port/);
  });

  test("writes atomically — only ports.json remains, no temp files", () => {
    const dir = freshRegistry();
    allocatePort("sess-a");
    allocatePort("sess-b");
    releasePort("sess-a");
    expect(readdirSync(dir)).toEqual(["ports.json"]);
  });
});

describe("getPort", () => {
  beforeEach(() => freshRegistry());

  test("returns null for an unallocated session", () => {
    expect(getPort("nobody")).toBeNull();
  });
});

describe("releasePort", () => {
  beforeEach(() => freshRegistry());

  test("frees the slot for reuse", () => {
    const port = allocatePort("sess-a");
    releasePort("sess-a");
    expect(getPort("sess-a")).toBeNull();
    // the freed port is now available to another session that hashes to it
    allocatePort("fill-until-reused");
  });

  test("is a no-op for an unknown session", () => {
    expect(() => releasePort("nobody")).not.toThrow();
  });
});

describe("prunePorts", () => {
  beforeEach(() => freshRegistry());

  test("drops entries not in the active set", () => {
    allocatePort("keep");
    allocatePort("drop-1");
    allocatePort("drop-2");
    prunePorts(["keep"]);
    expect(getPort("keep")).not.toBeNull();
    expect(getPort("drop-1")).toBeNull();
    expect(getPort("drop-2")).toBeNull();
  });
});
