import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  pruneSessionMarkers,
  pruneStaleContractMarkers,
  _setRuntimeDir,
  _getRuntimeDir,
} from "./runtime";

let dir: string;
const original = _getRuntimeDir();

function touch(name: string, ageMs = 0): string {
  const p = join(dir, name);
  writeFileSync(p, "");
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    utimesSync(p, when, when);
  }
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bertrand-runtime-"));
  _setRuntimeDir(dir);
});

afterEach(() => {
  _setRuntimeDir(original);
  rmSync(dir, { recursive: true, force: true });
});

describe("pruneSessionMarkers", () => {
  test("removes this session's and conversation's markers", () => {
    touch("done-sid1");
    touch("auq-nudge-sid1");
    touch("working-sid1");
    touch("contract-sent-cid1");

    pruneSessionMarkers("sid1", "cid1");

    expect(existsSync(join(dir, "done-sid1"))).toBe(false);
    expect(existsSync(join(dir, "auq-nudge-sid1"))).toBe(false);
    expect(existsSync(join(dir, "working-sid1"))).toBe(false);
    expect(existsSync(join(dir, "contract-sent-cid1"))).toBe(false);
  });

  test("leaves other sessions' markers untouched", () => {
    touch("done-sid1");
    touch("done-sid2");
    touch("contract-sent-cid2");

    pruneSessionMarkers("sid1", "cid1");

    expect(existsSync(join(dir, "done-sid2"))).toBe(true);
    expect(existsSync(join(dir, "contract-sent-cid2"))).toBe(true);
  });

  test("no conversation id → leaves contract markers alone", () => {
    touch("contract-sent-cid1");
    pruneSessionMarkers("sid1");
    expect(existsSync(join(dir, "contract-sent-cid1"))).toBe(true);
  });

  test("missing files are a no-op (no throw)", () => {
    expect(() => pruneSessionMarkers("ghost", "ghost")).not.toThrow();
  });
});

describe("pruneStaleContractMarkers", () => {
  test("removes contract markers older than the cutoff, keeps fresh ones", () => {
    touch("contract-sent-old", 48 * 60 * 60 * 1000);
    touch("contract-sent-fresh", 0);

    pruneStaleContractMarkers(24 * 60 * 60 * 1000);

    expect(existsSync(join(dir, "contract-sent-old"))).toBe(false);
    expect(existsSync(join(dir, "contract-sent-fresh"))).toBe(true);
  });

  test("only touches contract-sent markers, never other state", () => {
    touch("done-sid1", 48 * 60 * 60 * 1000);
    touch("auq-nudge-sid1", 48 * 60 * 60 * 1000);
    touch("contract-sent-old", 48 * 60 * 60 * 1000);

    pruneStaleContractMarkers(24 * 60 * 60 * 1000);

    expect(existsSync(join(dir, "done-sid1"))).toBe(true);
    expect(existsSync(join(dir, "auq-nudge-sid1"))).toBe(true);
    expect(existsSync(join(dir, "contract-sent-old"))).toBe(false);
  });

  test("missing runtime dir is a no-op (no throw)", () => {
    _setRuntimeDir(join(dir, "does-not-exist"));
    expect(() => pruneStaleContractMarkers()).not.toThrow();
  });
});
