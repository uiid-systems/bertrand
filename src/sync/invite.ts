import type { SyncConfig } from "@/sync/config";

const SCHEME = "bertrand-sync://";
const VERSION = 3;

type Bundle = {
  v: number;
  url: string;
  key: string; // service_role JWT
  bucket: string;
  obj: string;
  ek: string; // encryption key (base64)
};

export type DecodedInvite = {
  config: Omit<SyncConfig, "clientName">;
};

/**
 * Encode a sync configuration as a single paste-able string for use on another
 * machine. The bundle is **not encrypted** — it's just base64-encoded JSON. It
 * contains a Supabase service_role token and the database's encryption key, so
 * treat it like an SSH private key: transmit only over a secure channel
 * (Signal, iMessage, AirDrop), and don't paste it in unencrypted IM/email.
 *
 * Credentials only. A v2 bundle also carried a project slug and display name,
 * so the receiving machine could create the named project the data belonged to
 * rather than dumping it into whichever one happened to be active. There are
 * no projects: a bundle now names one database, and importing it means "pull
 * that database onto this machine".
 */
export function encodeInvite(cfg: SyncConfig): string {
  const bundle: Bundle = {
    v: VERSION,
    url: cfg.supabaseUrl,
    key: cfg.supabaseServiceKey,
    bucket: cfg.bucket,
    obj: cfg.objectKey,
    ek: cfg.encryptionKey,
  };
  return SCHEME + Buffer.from(JSON.stringify(bundle), "utf8").toString("base64url");
}

export function isInvite(value: string): boolean {
  return typeof value === "string" && value.startsWith(SCHEME);
}

export function decodeInvite(invite: string): DecodedInvite {
  if (!invite.startsWith(SCHEME)) {
    throw new Error(`invite must start with ${SCHEME}`);
  }
  const payload = invite.slice(SCHEME.length).trim();
  let parsed: unknown;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new Error("invite is malformed — could not decode base64/JSON payload");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invite payload is not a JSON object");
  }
  const bundle = parsed as Partial<Bundle>;
  if (bundle.v !== VERSION) {
    // Hard cutover, as v1 → v2 was. An older bundle describes a project — a
    // registry row and a per-project database — that the receiving machine has
    // no way to create any more, so accepting one would mean guessing what its
    // slug was supposed to mean. Both machines must run a bertrand that groups
    // sessions by cwd.
    throw new Error(
      `invite version ${String(bundle.v)} is not supported (expected v${VERSION}). ` +
        `Both machines must run a bertrand with one database. ` +
        `Upgrade the source machine and regenerate the invite.`
    );
  }
  for (const field of ["url", "key", "bucket", "obj", "ek"] as const) {
    if (!bundle[field] || typeof bundle[field] !== "string") {
      throw new Error(`invite is missing required field: ${field}`);
    }
  }
  return {
    config: {
      supabaseUrl: bundle.url!,
      supabaseServiceKey: bundle.key!,
      bucket: bundle.bucket!,
      objectKey: bundle.obj!,
      encryptionKey: bundle.ek!,
    },
  };
}
