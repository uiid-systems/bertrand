import { createClient } from "@supabase/supabase-js";
import { readFileSync, renameSync, statSync, openSync, writeSync, fsyncSync, closeSync } from "fs";
import { dirname } from "path";
import { execFileSync } from "child_process";
import { resolveActiveProject } from "@/lib/projects/resolve";
import { loadSyncConfig, hasSyncConfig } from "@/sync/config";
import { takeSnapshot, cleanupSnapshot } from "@/sync/snapshot";
import { encrypt, decrypt } from "@/sync/crypto";

export type SyncResult =
  | { ok: true; operation: "push" | "pull"; bytes: number; durationMs: number; pulled?: boolean }
  | { ok: false; operation: "push" | "pull"; error: string };

export type SyncStatus = {
  configured: boolean;
  local: { size: number; modifiedAt: Date } | null;
  remote: { size: number; modifiedAt: Date } | null;
};

function client(cfg: ReturnType<typeof loadSyncConfig>) {
  if (!cfg) return null;
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Push: VACUUM INTO snapshot (lock-free), encrypt the snapshot bytes,
 * upload to Supabase Storage with upsert. Existing remote object is
 * replaced — single-active-machine sync model, last-push-wins by design.
 */
export async function push(): Promise<SyncResult> {
  if (!hasSyncConfig()) {
    return { ok: false, operation: "push", error: "no sync config — run `bertrand sync onboard`" };
  }
  const cfg = loadSyncConfig();
  const supabase = client(cfg);
  if (!cfg || !supabase) {
    return { ok: false, operation: "push", error: "sync config incomplete" };
  }

  const started = performance.now();
  try {
    let snapshotPath: string;
    try {
      snapshotPath = takeSnapshot();
    } catch (e) {
      return {
        ok: false,
        operation: "push",
        error: `snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    const plaintext = readFileSync(snapshotPath);
    const ciphertext = encrypt(plaintext, cfg.encryptionKey);
    const { error } = await supabase.storage
      .from(cfg.bucket)
      .upload(cfg.objectKey, ciphertext, {
        contentType: "application/octet-stream",
        upsert: true,
      });
    if (error) {
      return { ok: false, operation: "push", error: `upload failed: ${error.message}` };
    }
    return {
      ok: true,
      operation: "push",
      bytes: ciphertext.length,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    return { ok: false, operation: "push", error: e instanceof Error ? e.message : String(e) };
  } finally {
    // Outer-finally cleanup: covers the case where takeSnapshot() throws
    // partway through (a partial file would otherwise linger) and the
    // normal happy-path teardown.
    cleanupSnapshot();
  }
}

/**
 * Pull: download the encrypted blob, decrypt to a temp file, then atomically
 * rename over bertrand.db. Refuses to run if any other process holds the
 * live DB open (the rename would either fail or strand the running process
 * with a deleted-but-still-open file). Detection uses `lsof`; if `lsof`
 * isn't available the user can override with --force.
 */
export async function pull(opts: { force?: boolean } = {}): Promise<SyncResult> {
  if (!hasSyncConfig()) {
    return { ok: false, operation: "pull", error: "no sync config — run `bertrand sync onboard`" };
  }
  const cfg = loadSyncConfig();
  const supabase = client(cfg);
  if (!cfg || !supabase) {
    return { ok: false, operation: "pull", error: "sync config incomplete" };
  }

  const holders = findHolders(resolveActiveProject().db);
  if (holders.length > 0) {
    const procs = holders.map((h) => `${h.command}(${h.pid})`).join(", ");
    if (!opts.force) {
      return {
        ok: false,
        operation: "pull",
        error:
          `${resolveActiveProject().db} is held by ${procs} — close active bertrand sessions before pulling, ` +
          `or pass --force to overwrite anyway (risks corrupting the running session).`,
      };
    }
    console.warn(`warning: --force pulling while ${procs} hold ${resolveActiveProject().db}. The running process may crash on next file access.`);
  }

  const started = performance.now();
  try {
    const { data, error } = await supabase.storage
      .from(cfg.bucket)
      .download(cfg.objectKey);
    if (error || !data) {
      // Object not found is the "fresh remote, nothing to pull" case — surface
      // it as ok=true so the launch-time auto-pull doesn't spam errors.
      if (error?.message?.toLowerCase().includes("not found")) {
        return {
          ok: true,
          operation: "pull",
          pulled: false,
          bytes: 0,
          durationMs: Math.round(performance.now() - started),
        };
      }
      return { ok: false, operation: "pull", error: `download failed: ${error?.message ?? "no data"}` };
    }
    const ciphertext = Buffer.from(await data.arrayBuffer());
    const plaintext = decrypt(ciphertext, cfg.encryptionKey);

    // Write to a temp file in the same directory so rename is atomic on the
    // same filesystem. fsync the tmp file AND its parent directory before
    // rename so a crash between write and rename can't leave a torn DB —
    // the rename only becomes durable once the directory entry hits disk.
    // We intentionally don't touch `.db-wal` / `.db-shm` — bertrand opens
    // the file fresh next launch in WAL mode and recreates them.
    const tmp = `${resolveActiveProject().db}.pull-${process.pid}`;
    const fd = openSync(tmp, "w");
    try {
      writeSync(fd, plaintext);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, resolveActiveProject().db);
    const dirFd = openSync(dirname(resolveActiveProject().db), "r");
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }

    return {
      ok: true,
      operation: "pull",
      pulled: true,
      bytes: plaintext.length,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    return { ok: false, operation: "pull", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function status(): Promise<SyncStatus> {
  const cfg = loadSyncConfig();
  if (!cfg) return { configured: false, local: null, remote: null };

  let local: SyncStatus["local"] = null;
  try {
    const s = statSync(resolveActiveProject().db);
    local = { size: s.size, modifiedAt: new Date(s.mtimeMs) };
  } catch {
    local = null;
  }

  const supabase = client(cfg);
  let remote: SyncStatus["remote"] = null;
  if (supabase) {
    try {
      const parentPath = cfg.objectKey.includes("/")
        ? cfg.objectKey.slice(0, cfg.objectKey.lastIndexOf("/"))
        : "";
      const fileName = cfg.objectKey.includes("/")
        ? cfg.objectKey.slice(cfg.objectKey.lastIndexOf("/") + 1)
        : cfg.objectKey;
      const { data, error } = await supabase.storage
        .from(cfg.bucket)
        .list(parentPath, { search: fileName });
      if (!error && data) {
        const match = data.find((f) => f.name === fileName);
        if (match) {
          remote = {
            size: (match.metadata as { size?: number } | undefined)?.size ?? 0,
            modifiedAt: new Date(match.updated_at ?? match.created_at ?? Date.now()),
          };
        }
      }
    } catch {
      // Network errors → leave remote=null; CLI distinguishes "configured but unreachable"
      // from "not configured" via the configured flag.
    }
  }

  return { configured: true, local, remote };
}

type Holder = { pid: number; command: string };

/**
 * Use `lsof` to find PIDs holding the given path open. macOS / Linux only;
 * absent on Windows but that's not a target. Excludes our own PID so a
 * shell that opened the file briefly for a stat doesn't block us.
 *
 * Uses `execFileSync` with array args (not `execSync` with a shell string)
 * so the path is passed to lsof verbatim without any shell-quoting puzzle.
 */
function findHolders(path: string): Holder[] {
  try {
    const out = execFileSync("lsof", ["-F", "pcn", path], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const holders: Holder[] = [];
    let pid = 0;
    let command = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("c")) command = line.slice(1);
      else if (line.startsWith("n")) {
        if (pid && pid !== process.pid && command) {
          holders.push({ pid, command });
        }
      }
    }
    return holders;
  } catch {
    // lsof exits non-zero when no process holds the path (and when the
    // binary is missing). Either way: assume no holders.
    return [];
  }
}

