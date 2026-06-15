import type { SyncConfig } from "@/sync/config";

const SCHEME = "bertrand-sync://";
const VERSION = 2;

type Bundle = {
  v: number;
  url: string;
  key: string; // service_role JWT
  bucket: string;
  obj: string;
  ek: string; // encryption key (base64)
  psl: string; // project slug
  pn: string; // project display name
};

export type InviteProject = {
  slug: string;
  name: string;
};

export type DecodedInvite = {
  config: Omit<SyncConfig, "clientName">;
  project: InviteProject;
};

/**
 * Encode a sync configuration + project identity as a single paste-able
 * string for use on another machine. The bundle is **not encrypted** —
 * it's just base64-encoded JSON. It contains a Supabase service_role
 * token and the project's DB encryption key, so treat it like an SSH
 * private key: transmit only over a secure channel (Signal, iMessage,
 * AirDrop), and don't paste it in unencrypted IM/email.
 *
 * The project identity (slug + display name) travels alongside the
 * credentials so the receiving machine knows which named project to
 * create rather than dumping the data into whichever project happens
 * to be active.
 */
export function encodeInvite(cfg: SyncConfig, project: InviteProject): string {
  const bundle: Bundle = {
    v: VERSION,
    url: cfg.supabaseUrl,
    key: cfg.supabaseServiceKey,
    bucket: cfg.bucket,
    obj: cfg.objectKey,
    ek: cfg.encryptionKey,
    psl: project.slug,
    pn: project.name,
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
    // Hard cutover: v1 bundles don't carry project identity, so importing
    // one would dump the source machine's data into whatever project
    // happens to be active locally — surprising and prone to mistakes.
    // Both machines must run a v2-aware bertrand.
    throw new Error(
      `invite version ${String(bundle.v)} is not supported (expected v${VERSION}). ` +
        `Both machines must run a per-project-aware bertrand. ` +
        `Upgrade the source machine and regenerate the invite.`
    );
  }
  for (const field of ["url", "key", "bucket", "obj", "ek", "psl", "pn"] as const) {
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
    project: {
      slug: bundle.psl!,
      name: bundle.pn!,
    },
  };
}
