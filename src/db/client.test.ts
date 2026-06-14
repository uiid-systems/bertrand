import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { projectPaths } from "@/lib/projects/paths";
import {
  getDb,
  getDbForProject,
  invalidateDbCache,
  _clearTestDb,
} from "./client";

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-client-"));
  _setRegistryDir(tmpRoot);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  _clearTestDb();
});

afterEach(() => {
  _clearTestDb();
  _setRegistryDir(originalDir);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("getDb()", () => {
  test("opens the active project's DB and caches the handle", () => {
    const first = getDb();
    const second = getDb();
    expect(first).toBe(second);
  });

  test("creates the project directory on first open", () => {
    const expected = projectPaths("default");
    getDb();
    const fs = require("fs") as typeof import("fs");
    expect(fs.existsSync(expected.db)).toBe(true);
  });

  test("running lazy migrations gives the new DB its schema", () => {
    const db = getDb();
    // categories table is part of migration 0003 — querying it should
    // succeed (returning [] on a fresh DB), not throw.
    const result = db.$client.prepare("SELECT count(*) as n FROM categories").get();
    expect(result).toEqual({ n: 0 });
  });
});

describe("getDbForProject(slug)", () => {
  test("opens at the slug's path, independently from getDb()", () => {
    process.env.BERTRAND_PROJECT = "alpha";
    _resetActiveProjectCache();

    const active = getDb();
    const beta = getDbForProject("beta");

    expect(active).not.toBe(beta);

    const fs = require("fs") as typeof import("fs");
    expect(fs.existsSync(projectPaths("alpha").db)).toBe(true);
    expect(fs.existsSync(projectPaths("beta").db)).toBe(true);
  });

  test("returns the same handle on repeated calls for the same slug", () => {
    const first = getDbForProject("acme");
    const second = getDbForProject("acme");
    expect(first).toBe(second);
  });
});

describe("invalidateDbCache", () => {
  test("clearing a slug forces a fresh open for that project only", () => {
    const a1 = getDbForProject("a");
    const b1 = getDbForProject("b");

    invalidateDbCache("a");

    const a2 = getDbForProject("a");
    const b2 = getDbForProject("b");

    expect(a2).not.toBe(a1);
    expect(b2).toBe(b1);
  });

  test("no-arg call clears every cached handle", () => {
    const a1 = getDbForProject("a");
    const b1 = getDbForProject("b");

    invalidateDbCache();

    expect(getDbForProject("a")).not.toBe(a1);
    expect(getDbForProject("b")).not.toBe(b1);
  });
});
