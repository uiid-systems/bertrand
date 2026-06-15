import { hostname } from "os";
import { decodeInvite } from "@/sync/invite";
import { saveSyncConfig } from "@/sync/config";
import { pull } from "@/sync/engine";
import { listProjects, setActiveProjectSlug } from "@/lib/projects/registry";
import { createProject } from "@/lib/projects/create";
import { resolveActiveProject, _resetActiveProjectCache } from "@/lib/projects/resolve";
import { patchConfig } from "@/lib/config";

export type BootstrapResult =
  | { ok: false; reason: "decode-failed" | "slug-collision" | "pull-failed"; error: string }
  | {
      ok: true;
      project: { slug: string; name: string };
      pulled: boolean;
      bytes: number;
      durationMs: number;
    };

/**
 * Import a v2 invite bundle end-to-end: decode, create the named project
 * locally, write per-project sync.env, activate, run first pull.
 *
 * Refuses on slug collision rather than silently overwriting — if a
 * project with the invited slug already exists locally with unrelated
 * data, joining the two would be confusing. The caller can offer to
 * `remove --purge` the existing one first.
 *
 * Side effects: creates a project entry, writes ~/.bertrand/projects/<slug>/
 * (db + sync.env), and flips the active project to the imported one.
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

  const { config: cfg, project } = decoded;

  if (listProjects().some((p) => p.slug === project.slug)) {
    return {
      ok: false,
      reason: "slug-collision",
      error: `Project "${project.slug}" already exists on this machine. Remove it first (\`bertrand project remove ${project.slug} --purge\`) or rename it before importing.`,
    };
  }

  createProject({ slug: project.slug, name: project.name });
  setActiveProjectSlug(project.slug);
  _resetActiveProjectCache();

  // Re-resolve so saveSyncConfig writes into the newly-activated project's
  // sync.env (rather than wherever was active before the createProject call).
  resolveActiveProject();
  saveSyncConfig({ ...cfg, clientName: `bertrand-${hostname()}` });
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
    project,
    pulled: result.pulled ?? false,
    bytes: result.bytes ?? 0,
    durationMs: result.durationMs ?? 0,
  };
}
