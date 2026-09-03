import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { _setRootDir, paths } from "@/lib/paths";
import { _clearTestDb } from "@/db/client";
import { readConfig } from "@/lib/config";
import { encodeInvite } from "./invite";
import { bootstrapFromInvite } from "./bootstrap";
import { loadSyncConfig, type SyncConfig } from "./config";

const SAMPLE_CONFIG: SyncConfig = {
  supabaseUrl: "https://abcdefghij1234567890.supabase.co",
  supabaseServiceKey: "eyJ.signed-jwt.signature",
  bucket: "bertrand",
  objectKey: "bertrand.db.enc",
  encryptionKey: "k1XyhPTwjUelDqp4WfPGn5J6tBxKMrJWTL4OGZ3UAGI=",
  clientName: "bertrand-laptop",
};

let tmpRoot: string;

beforeEach(() => {
  // Redirects every path bertrand owns — `sync.env`, `config.json` and the
  // database the pull would replace. This used to be `_setRegistryDir`, which
  // reached the per-project tree but not the top-level paths; the collapse to
  // one database moved the knob to `@/lib/paths`.
  tmpRoot = mkdtempSync(join(tmpdir(), "bertrand-bootstrap-"));
  _setRootDir(tmpRoot);
  _clearTestDb();
});

afterEach(() => {
  _clearTestDb();
  // null restores the real home, which is what this file started from.
  _setRootDir(null);
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

  test("writes sync.env and enables sync before the pull is attempted", async () => {
    // The pull can't be avoided inside the helper and will fail here (there is
    // no real Supabase), so asserting the credentials landed after a failed
    // bootstrap is what proves the side effects happen before the network.
    const result = await bootstrapFromInvite(encodeInvite(SAMPLE_CONFIG));

    expect(existsSync(paths.syncEnv)).toBe(true);
    expect(loadSyncConfig()).toMatchObject({
      supabaseUrl: SAMPLE_CONFIG.supabaseUrl,
      bucket: SAMPLE_CONFIG.bucket,
      objectKey: SAMPLE_CONFIG.objectKey,
      encryptionKey: SAMPLE_CONFIG.encryptionKey,
    });
    // The receiving machine names itself rather than inheriting the sender's.
    expect(loadSyncConfig()?.clientName).not.toBe(SAMPLE_CONFIG.clientName);
    expect(readConfig()?.sync?.enabled).toBe(true);

    if (!result.ok) {
      expect(result.reason).toBe("pull-failed");
    }
  });

  test("creates and switches nothing — there is no registry to write", async () => {
    // What this used to do: create a project named by the bundle, refuse on a
    // slug collision, flip the active project to it, then write credentials
    // into that project's own sync.env. Importing is now "pull into this
    // machine's database", so the only file it touches beside sync.env is
    // config.json's sync flag.
    await bootstrapFromInvite(encodeInvite(SAMPLE_CONFIG));

    expect(existsSync(join(tmpRoot, "projects.json"))).toBe(false);
    expect(existsSync(join(tmpRoot, "projects"))).toBe(false);
  });
});
