import {
  readFileSync,
  statSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from "fs";
// `0600` enforcement happens on read so a hostile umask or external edit
// doesn't leave the file world-readable for long. We re-chmod and log a
// warning; both are silent in background-spawned trigger contexts but
// surface in foreground CLI runs, which is the user-facing escape hatch.
import { resolveActiveProject } from "@/lib/projects/resolve";

export type SyncConfig = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  bucket: string;
  objectKey: string;
  encryptionKey: string;
  clientName: string;
};

const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "BERTRAND_SYNC_BUCKET",
  "BERTRAND_SYNC_OBJECT",
  "BERTRAND_ENCRYPTION_KEY",
  "BERTRAND_CLIENT_NAME",
] as const;
type Key = (typeof KEYS)[number];

function parseEnv(contents: string): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim() as Key;
    if (!KEYS.includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Default to the active project's per-project sync.env. */
function defaultPath(): string {
  return resolveActiveProject().syncEnv;
}

export function hasSyncConfig(syncEnvPath?: string): boolean {
  return existsSync(syncEnvPath ?? defaultPath());
}

export function loadSyncConfig(syncEnvPath?: string): SyncConfig | null {
  const path = syncEnvPath ?? defaultPath();
  if (!existsSync(path)) return null;

  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    console.warn(
      `warning: ${path} was mode 0${mode.toString(8)} (should be 0600). Tightening to 0600.`
    );
    try {
      chmodSync(path, 0o600);
    } catch (e) {
      console.warn(
        `failed to chmod 0600: ${e instanceof Error ? e.message : String(e)}. Fix manually.`
      );
    }
  }

  const env = parseEnv(readFileSync(path, "utf8"));
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_KEY ||
    !env.BERTRAND_SYNC_BUCKET ||
    !env.BERTRAND_ENCRYPTION_KEY
  ) {
    return null;
  }

  return {
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY,
    bucket: env.BERTRAND_SYNC_BUCKET,
    objectKey: env.BERTRAND_SYNC_OBJECT || "bertrand.db.enc",
    encryptionKey: env.BERTRAND_ENCRYPTION_KEY,
    clientName:
      env.BERTRAND_CLIENT_NAME ||
      `bertrand-${process.platform}-${process.pid}`,
  };
}

export function saveSyncConfig(cfg: SyncConfig, syncEnvPath?: string): void {
  const path = syncEnvPath ?? defaultPath();
  const lines = [
    "# bertrand sync configuration",
    "# Created by `bertrand sync onboard`. chmod 600.",
    "#",
    "# SUPABASE_SERVICE_KEY has read+write access to your storage bucket.",
    "# Treat it like an SSH private key. Do not commit. Do not share.",
    "#",
    "# BERTRAND_ENCRYPTION_KEY is the AES-256-GCM key used to encrypt the DB",
    "# locally before upload. Without it the uploaded blob can't be decrypted.",
    "# Use the SAME key on every machine that should be able to pull this DB.",
    `SUPABASE_URL=${cfg.supabaseUrl}`,
    `SUPABASE_SERVICE_KEY=${cfg.supabaseServiceKey}`,
    `BERTRAND_SYNC_BUCKET=${cfg.bucket}`,
    `BERTRAND_SYNC_OBJECT=${cfg.objectKey}`,
    `BERTRAND_ENCRYPTION_KEY=${cfg.encryptionKey}`,
    `BERTRAND_CLIENT_NAME=${cfg.clientName}`,
    "",
  ];
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  chmodSync(path, 0o600);
}
