import { hostname } from "os";
import { decodeInvite } from "@/sync/invite";
import { saveSyncConfig } from "@/sync/config";
import { pull } from "@/sync/engine";
import { patchConfig } from "@/lib/config";
import { paths } from "@/lib/paths";

export type BootstrapResult =
  | { ok: false; reason: "decode-failed" | "pull-failed"; error: string }
  | {
      ok: true;
      /** The database the pull landed in. */
      dbPath: string;
      pulled: boolean;
      bytes: number;
      durationMs: number;
    };

/**
 * Import an invite bundle end-to-end: decode, write this machine's sync.env,
 * enable the auto-triggers, run the first pull.
 *
 * Considerably less than it used to do. A v2 bundle carried a project slug and
 * display name, so importing meant creating that project locally, refusing on
 * a slug collision, flipping the active project to the new one, and only then
 * writing credentials into its per-project sync.env. Every one of those steps
 * existed to answer "which of this machine's databases does the remote one
 * correspond to?" — a question with one answer now, so there is no registry to
 * write, nothing to collide with, and no active project to flip.
 *
 * Side effects: writes `~/.bertrand/sync.env` (mode 0600), sets
 * `sync.enabled`, and **replaces `~/.bertrand/bertrand.db`** with the remote
 * one. That last is the pull's own atomic rename and it refuses while another
 * process holds the file open — see `pull`.
 */
export async function bootstrapFromInvite(invite: string): Promise<BootstrapResult> {
  let decoded: ReturnType<typeof decodeInvite>;
  try {
    decoded = decodeInvite(invite);
  } catch (e) {
    return {
      ok: false,
      reason: "decode-failed",
      error: e instanceof Error ? e.message : String(e),
    };
  }

  saveSyncConfig({ ...decoded.config, clientName: `bertrand-${hostname()}` });
  patchConfig({ sync: { enabled: true } });

  const result = await pull();
  if (!result.ok) {
    return {
      ok: false,
      reason: "pull-failed",
      error: result.error,
    };
  }

  return {
    ok: true,
    dbPath: paths.db,
    pulled: result.pulled ?? false,
    bytes: result.bytes ?? 0,
    durationMs: result.durationMs ?? 0,
  };
}
