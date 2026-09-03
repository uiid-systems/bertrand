import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  adoptionMarkerPath,
  pruneSessionMarkers,
  pruneStaleMarkers,
  readAdoptionMarker,
  writeAdoptionMarker,
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

/** Backdate a marker written through the real writer. */
function age(path: string, ageMs: number): void {
  const when = new Date(Date.now() - ageMs);
  utimesSync(path, when, when);
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

  test("removes the adoption marker so a resumed conversation re-attaches", () => {
    writeAdoptionMarker("cid1", { sessionId: "sid1" });

    pruneSessionMarkers("sid1", "cid1");

    // Left behind, it would let a `claude --resume` keep writing events onto a
    // session that already has an endedAt and materialized stats.
    expect(existsSync(adoptionMarkerPath("cid1"))).toBe(false);
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

describe("pruneStaleMarkers", () => {
  test("removes contract markers older than the cutoff, keeps fresh ones", () => {
    touch("contract-sent-old", 48 * 60 * 60 * 1000);
    touch("contract-sent-fresh", 0);

    pruneStaleMarkers(24 * 60 * 60 * 1000);

    expect(existsSync(join(dir, "contract-sent-old"))).toBe(false);
    expect(existsSync(join(dir, "contract-sent-fresh"))).toBe(true);
  });

  test("only touches contract-sent markers, never other state", () => {
    touch("done-sid1", 48 * 60 * 60 * 1000);
    touch("auq-nudge-sid1", 48 * 60 * 60 * 1000);
    touch("contract-sent-old", 48 * 60 * 60 * 1000);

    pruneStaleMarkers(24 * 60 * 60 * 1000);

    expect(existsSync(join(dir, "done-sid1"))).toBe(true);
    expect(existsSync(join(dir, "auq-nudge-sid1"))).toBe(true);
    expect(existsSync(join(dir, "contract-sent-old"))).toBe(false);
  });

  test("sweeps an adoption marker whose claude is gone", async () => {
    const child = spawn("true", [], { stdio: "ignore" });
    const deadPid = child.pid!;
    await new Promise((r) => child.on("exit", r));

    writeAdoptionMarker("cid-dead", { sessionId: "sid1", pid: deadPid });
    age(adoptionMarkerPath("cid-dead"), 48 * 60 * 60 * 1000);

    pruneStaleMarkers(24 * 60 * 60 * 1000);

    expect(existsSync(adoptionMarkerPath("cid-dead"))).toBe(false);
  });

  test("keeps an adoption marker while its claude is still running", async () => {
    const child = spawn("sleep", ["30"], { stdio: "ignore" });
    try {
      writeAdoptionMarker("cid-live", { sessionId: "sid1", pid: child.pid! });
      // Old enough to sweep on age alone — an adopted claude can legitimately
      // stay open for days, and sweeping it would silently stop recording a
      // session the user is still working in.
      age(adoptionMarkerPath("cid-live"), 48 * 60 * 60 * 1000);

      pruneStaleMarkers(24 * 60 * 60 * 1000);

      expect(existsSync(adoptionMarkerPath("cid-live"))).toBe(true);
    } finally {
      child.kill();
    }
  });

  test("keeps a fresh adoption marker whose pid is unknown", () => {
    writeAdoptionMarker("cid-nopid", { sessionId: "sid1" });

    pruneStaleMarkers(24 * 60 * 60 * 1000);

    // No pid means "can't tell", so age is the only signal left — and this one
    // is new.
    expect(existsSync(adoptionMarkerPath("cid-nopid"))).toBe(true);
  });

  test("missing runtime dir is a no-op (no throw)", () => {
    _setRuntimeDir(join(dir, "does-not-exist"));
    expect(() => pruneStaleMarkers()).not.toThrow();
  });
});

describe("adoption marker round-trip", () => {
  test("carries the pid through write and read", () => {
    writeAdoptionMarker("cid1", { sessionId: "sid1", pid: 4242 });
    expect(readAdoptionMarker("cid1")).toEqual({ sessionId: "sid1", pid: 4242 });
  });

  test("omits the pid rather than writing an empty one", () => {
    writeAdoptionMarker("cid1", { sessionId: "sid1" });
    expect(readAdoptionMarker("cid1")).toEqual({ sessionId: "sid1" });
  });

  test("ignores a non-numeric pid instead of trusting it", () => {
    writeFileSync(adoptionMarkerPath("cid1"), "session=sid1\npid=notapid\n");
    // A garbage pid must not become NaN and get signalled or compared.
    expect(readAdoptionMarker("cid1")?.pid).toBeUndefined();
  });

  test("ignores pid 0, which would read as permanently alive", () => {
    // kill(0, 0) signals the caller's own process group and always succeeds,
    // so trusting it would pin the marker on disk forever.
    writeFileSync(adoptionMarkerPath("cid1"), "session=sid1\npid=0\n");
    expect(readAdoptionMarker("cid1")?.pid).toBeUndefined();
  });

  test("still resolves markers written before pid was recorded", () => {
    writeFileSync(adoptionMarkerPath("cid1"), "session=sid1\n");
    expect(readAdoptionMarker("cid1")).toEqual({ sessionId: "sid1" });
  });

  test("ignores a stale project= line from an older bertrand", () => {
    // Markers on disk survive an upgrade, and the field is gone: parsing must
    // not choke on it, and must not resurrect it either.
    writeFileSync(adoptionMarkerPath("cid1"), "session=sid1\nproject=acme\n");
    expect(readAdoptionMarker("cid1")).toEqual({ sessionId: "sid1" });
  });
});
