import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  _setRegistryDir,
  _getRegistryDir,
  listProjects,
  getActiveProjectSlug,
} from "@/lib/projects/registry";
import { createProject } from "@/lib/projects/create";
import { _resetActiveProjectCache } from "@/lib/projects/resolve";
import { projectPaths } from "@/lib/projects/paths";
import { _clearTestDb } from "@/db/client";
import { encodeInvite } from "./invite";
import { bootstrapFromInvite } from "./bootstrap";
import type { SyncConfig } from "./config";

const SAMPLE_CONFIG: SyncConfig = {
  supabaseUrl: "https://abcdefghij1234567890.supabase.co",
  supabaseServiceKey: "eyJ.signed-jwt.signature",
  bucket: "bertrand",
  objectKey: "projects/acme/bertrand.db.enc",
  encryptionKey: "k1XyhPTwjUelDqp4WfPGn5J6tBxKMrJWTL4OGZ3UAGI=",
  clientName: "bertrand-laptop",
};

let tmpRoot: string;
const originalDir = _getRegistryDir();

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-bootstrap-"));
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

describe("bootstrapFromInvite — error paths (no network)", () => {
  test("returns decode-failed on malformed bundle", async () => {
    const result = await bootstrapFromInvite("not-an-invite");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("decode-failed");
    }
  });

  test("returns slug-collision when local project already exists", async () => {
    // Seed a local project with the same slug the invite carries
    createProject({ slug: "acme", name: "Local Acme" });
    expect(listProjects().map((p) => p.slug)).toEqual(["acme"]);

    const invite = encodeInvite(SAMPLE_CONFIG, { slug: "acme", name: "Acme Corp" });
    const result = await bootstrapFromInvite(invite);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("slug-collision");
      expect(result.error).toMatch(/already exists/);
    }
    // Existing project not modified
    const entry = listProjects().find((p) => p.slug === "acme");
    expect(entry?.name).toBe("Local Acme");
  });

  test("creates project + activates + writes sync.env before pull is attempted", async () => {
    // We can't avoid the pull step in the bootstrap helper itself, but the
    // pull will fail in tests (no real Supabase). Asserting the project +
    // sync.env exist after a failed bootstrap proves the side effects
    // landed before the network attempt.
    const invite = encodeInvite(SAMPLE_CONFIG, { slug: "newproj", name: "New Project" });
    const result = await bootstrapFromInvite(invite);

    // The pull will fail (no real Supabase), so result.ok is false with
    // reason="pull-failed". That's OK — we're checking the pre-network
    // side effects.
    expect(listProjects().map((p) => p.slug)).toEqual(["newproj"]);
    expect(getActiveProjectSlug()).toBe("newproj");
    expect(existsSync(projectPaths("newproj").syncEnv)).toBe(true);

    if (!result.ok) {
      expect(result.reason).toBe("pull-failed");
    }
  });
});
