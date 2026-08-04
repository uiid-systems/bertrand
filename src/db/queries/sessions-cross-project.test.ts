import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  registerProject,
} from "@/lib/projects/registry";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { _clearTestDb, getDbForProject } from "@/db/client";
import {
  createSession,
  updateSessionStatus,
  countLiveSessionsAllProjects,
} from "@/db/queries/sessions";
import { getOrCreateCategoryPath } from "@/db/queries/categories";

/**
 * countLiveSessionsAllProjects backs stopServerIfIdle's shutdown check
 * (server-lifecycle.ts) — bertrand serve is one shared process across every
 * project, so this must see a live session in ANY project, not just whichever
 * one the calling process happens to be pinned to. Regression coverage for
 * the bug where ending a session in project "foo" killed the shared server
 * out from under a still-live session in project "bar".
 */

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-cross-project-"));
  _setRegistryDir(tmpRoot);
  _clearTestDb();
});

afterEach(() => {
  _clearTestDb();
  _setRegistryDir(originalDir);
  delete process.env.BERTRAND_PROJECT;
  _resetActiveProjectCache();
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Registers a project and creates one live session in it, as that project's own session process would. */
function addLiveSession(slug: string) {
  registerProject({ slug, name: slug });
  process.env.BERTRAND_PROJECT = slug;
  _resetActiveProjectCache();
  const categoryId = getOrCreateCategoryPath(`${slug}-cat`);
  const session = createSession({ categoryId, slug: "s", name: `${slug}/s` });
  updateSessionStatus(session.id, "active");
  return session;
}

describe("countLiveSessionsAllProjects", () => {
  test("counts a live session in another project, not just the current one", () => {
    addLiveSession("foo");
    addLiveSession("bar");

    expect(countLiveSessionsAllProjects()).toBe(2);
  });

  test("is 0 once every project's sessions are no longer live", () => {
    const foo = addLiveSession("foo");
    const bar = addLiveSession("bar");

    updateSessionStatus(foo.id, "paused", getDbForProject("foo"));
    expect(countLiveSessionsAllProjects()).toBe(1);

    updateSessionStatus(bar.id, "paused", getDbForProject("bar"));
    expect(countLiveSessionsAllProjects()).toBe(0);
  });
});
