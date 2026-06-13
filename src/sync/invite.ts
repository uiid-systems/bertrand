import type { SyncConfig } from "@/sync/config";

const SCHEME = "bertrand-sync://";
const VERSION = 1;

type Bundle = {
  v: number;
  url: string;
  key: string; // service_role JWT
  bucket: string;
  obj: string;
  ek: string; // encryption key (base64)
};

/**
 * Encode the current sync config as a single paste-able string for use on
 * another machine. The bundle is **not encrypted** — it's just base64-encoded
 * JSON. It contains a Supabase service_role token and your DB encryption key,
 * so treat it like an SSH private key: transmit only over a secure channel
 * (Signal, iMessage, AirDrop), and don't paste it in unencrypted IM/email.
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

export function decodeInvite(invite: string): Omit<SyncConfig, "clientName"> {
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
    throw new Error(
      `invite version ${String(bundle.v)} is not supported by this bertrand (expected v${VERSION}). ` +
        `Upgrade or downgrade so both machines run the same version.`
    );
  }
  for (const field of ["url", "key", "bucket", "obj", "ek"] as const) {
    if (!bundle[field] || typeof bundle[field] !== "string") {
      throw new Error(`invite is missing required field: ${field}`);
    }
  }
  return {
    supabaseUrl: bundle.url!,
    supabaseServiceKey: bundle.key!,
    bucket: bundle.bucket!,
    objectKey: bundle.obj!,
    encryptionKey: bundle.ek!,
  };
}
