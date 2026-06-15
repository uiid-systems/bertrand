import { hostname } from "os";
import { register } from "@/cli/router";
import { hasSyncConfig, loadSyncConfig, saveSyncConfig } from "@/sync/config";
import { push, pull, status } from "@/sync/engine";
import { generateKeyBase64 } from "@/sync/crypto";
import { encodeInvite, isInvite } from "@/sync/invite";
import { bootstrapFromInvite } from "@/sync/bootstrap";
import { listProjects } from "@/lib/projects/registry";
import {
  resolveActiveProject,
  _resetActiveProjectCache,
} from "@/lib/projects/resolve";
import { formatAgo } from "@/lib/format";
import { isSyncEnabled, patchConfig } from "@/lib/config";

function printUsage() {
  console.log(`
bertrand sync — replicate a project's local DB to Supabase Storage (opt-in)

Usage:
  bertrand sync onboard [--project <slug>]   Interactive setup for a project
  bertrand sync invite [--project <slug>]    Print a paste-able bundle
  bertrand sync <bundle>                     Decode bundle, create project, save config, pull
  bertrand sync push [--project <slug>]      VACUUM → encrypt → upload
  bertrand sync pull [--force] [--project <slug>]
                                             Download → decrypt → atomic-replace
  bertrand sync status [--project <slug>]    Local + remote object size and timestamps
  bertrand sync enable [--project <slug>]    Turn auto-triggers on
  bertrand sync disable [--project <slug>]   Turn auto-triggers off

All subcommands default to the active project. Pass --project to operate
on a different one without switching active.

Cross-machine setup:
  Machine A:  bertrand sync invite
              → bertrand-sync://eyJ…   (transmit via Signal/iMessage/AirDrop — sensitive)
  Machine B:  bertrand sync bertrand-sync://eyJ…
              → creates the project, onboards, pulls, ready
`.trim());
}

function abort(reason: string) {
  console.error(`Aborted: ${reason}`);
  process.exit(1);
}

/**
 * Strip the `--project <slug>` flag (and its `--project=<slug>` form) from
 * `args` and return both the slug (or undefined) and the leftover args.
 * Doesn't mutate the input.
 */
function extractProjectFlag(args: string[]): {
  slug: string | undefined;
  rest: string[];
} {
  const rest: string[] = [];
  let slug: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project") {
      slug = args[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--project=")) {
      slug = a.slice("--project=".length);
      continue;
    }
    rest.push(a);
  }
  return { slug, rest };
}

/**
 * If `--project` was passed, point the resolver at that project for the
 * remainder of the process. Done by setting `BERTRAND_PROJECT` in env
 * (the resolver checks it first) and clearing the memoized cache so the
 * next call re-reads. Throws if the slug isn't a known project.
 */
function applyProjectOverride(slug: string | undefined): void {
  if (!slug) return;
  const known = listProjects().some((p) => p.slug === slug);
  if (!known) {
    abort(`Unknown project: ${slug}. Run \`bertrand project list\` to see registered projects.`);
    return;
  }
  process.env.BERTRAND_PROJECT = slug;
  _resetActiveProjectCache();
}

function prompt(label: string, opts: { default?: string } = {}): Promise<string> {
  const suffix = opts.default ? ` [${opts.default}]` : "";
  process.stdout.write(`${label}${suffix}: `);
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r") {
          process.stdin.off("data", onData);
          process.stdin.pause();
          process.stdout.write("\n");
          return resolve(buf.trim() || opts.default || "");
        }
        buf += ch;
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function runOnboard() {
  const active = resolveActiveProject();
  const existing = loadSyncConfig();
  if (existing) {
    console.log(`Existing config for project "${active.slug}" at ${active.syncEnv}:`);
    console.log(`  SUPABASE_URL:           ${existing.supabaseUrl}`);
    console.log(`  SUPABASE_SERVICE_KEY:   ${existing.supabaseServiceKey.slice(0, 12)}…`);
    console.log(`  BERTRAND_SYNC_BUCKET:   ${existing.bucket}`);
    console.log(`  BERTRAND_SYNC_OBJECT:   ${existing.objectKey}`);
    console.log(`  BERTRAND_ENCRYPTION_KEY: (set, redacted)`);
    console.log(`  BERTRAND_CLIENT_NAME:   ${existing.clientName}`);
    console.log(`\nDelete ${active.syncEnv} and re-run to start over.`);
    return;
  }

  console.log(`Bertrand sync setup for project "${active.slug}" (${active.name})\n`);
  console.log(`In the Supabase dashboard (app.supabase.com):`);
  console.log(`  1. Create or pick a project`);
  console.log(`  2. Settings → General: copy the Project ID (the 20-char lowercase string`);
  console.log(`     shown under "Reference ID" — looks like "xxxxxxxxxxxxxxxxxxxx")`);
  console.log(`  3. Settings → API: copy the service_role key (NOT the anon key — service_role`);
  console.log(`     is below it and warns "keep secret")`);
  console.log(`  4. Storage → New bucket: name it "bertrand", PRIVATE (uncheck "Public bucket")\n`);

  const projectId = await prompt("Supabase Project ID");
  if (!projectId) return abort("no project ID provided");
  if (!/^[a-z0-9]{15,30}$/i.test(projectId)) {
    return abort(
      `"${projectId}" doesn't look like a Supabase project ID. ` +
        `Expected the 20-ish char string from Settings → General, not the project name.`
    );
  }
  const supabaseUrl = `https://${projectId}.supabase.co`;
  console.log(`  → Project URL: ${supabaseUrl}`);

  const supabaseServiceKey = await prompt("SUPABASE_SERVICE_KEY (eyJ…)");
  if (!supabaseServiceKey) return abort("no service key provided");
  if (!supabaseServiceKey.startsWith("eyJ")) {
    return abort("service key must be a JWT starting with eyJ — did you paste the URL by mistake?");
  }

  const bucket = await prompt("Storage bucket name", { default: "bertrand" });
  // Default the object key to a project-scoped path so multiple projects
  // can share the same Supabase bucket without colliding.
  const defaultObject = `projects/${active.slug}/bertrand.db.enc`;
  const objectKey = await prompt("Object key", { default: defaultObject });

  const defaultName = `bertrand-${hostname()}`;
  const clientName = await prompt("Client name", { default: defaultName });

  console.log(`\nEncryption key`);
  console.log(`  First machine?    Press ENTER to generate a fresh AES-256-GCM key.`);
  console.log(`  Additional machine? Paste the key from your other machine.\n`);
  const pasted = await prompt("BERTRAND_ENCRYPTION_KEY");
  let encryptionKey: string;
  if (pasted) {
    const decoded = Buffer.from(pasted, "base64");
    if (decoded.length !== 32) {
      return abort(
        `pasted key is ${decoded.length} bytes when decoded; expected 32. ` +
          `Copy the full key from your other machine without trimming.`
      );
    }
    encryptionKey = pasted;
    console.log(`  ✓ Using pasted key — this machine can decrypt blobs from the other one.\n`);
  } else {
    encryptionKey = generateKeyBase64();
    console.log(`\nGenerated a new key. Save this somewhere safe — you'll need it on every`);
    console.log(`other machine that should be able to pull this project:\n`);
    console.log(`  ${encryptionKey}\n`);
    console.log(`Hit ENTER to confirm you've saved it.`);
    await prompt("");
  }

  saveSyncConfig({ supabaseUrl, supabaseServiceKey, bucket, objectKey, encryptionKey, clientName });
  patchConfig({ sync: { enabled: true } });
  console.log(`Wrote ${active.syncEnv} (mode 0600). Sync auto-triggers enabled.`);
  console.log(`\nNext:`);
  console.log(`  bertrand sync push      Send this project's DB to Supabase`);
  console.log(`  bertrand sync invite    Generate a bundle to import on another machine`);
  console.log(`  bertrand sync status    See sizes and timestamps`);
}

async function runPush() {
  if (!hasSyncConfig()) return abort("no sync config for the active project — run `bertrand sync onboard`");
  process.stdout.write("Snapshot → encrypt → upload… ");
  const result = await push();
  if (result.ok) {
    console.log(`done (${formatBytes(result.bytes)} in ${result.durationMs}ms).`);
  } else {
    console.log("failed.");
    console.error(result.error);
    process.exit(1);
  }
}

async function runPull(args: string[]) {
  if (!hasSyncConfig()) return abort("no sync config for the active project — run `bertrand sync onboard`");
  const force = args.includes("--force");
  process.stdout.write("Download → decrypt → replace… ");
  const result = await pull({ force });
  if (result.ok) {
    if (result.pulled) {
      console.log(`done (${formatBytes(result.bytes)} in ${result.durationMs}ms).`);
    } else {
      console.log("no remote object yet — nothing to pull.");
    }
  } else {
    console.log("failed.");
    console.error(result.error);
    process.exit(1);
  }
}

async function runStatus() {
  const active = resolveActiveProject();
  if (!hasSyncConfig()) {
    console.log(`Sync is not configured for project "${active.slug}". Run \`bertrand sync onboard\` to set up.`);
    return;
  }
  console.log(`Sync status for project "${active.slug}" (${active.syncEnv}):`);
  console.log(`  Auto-triggers:       ${isSyncEnabled() ? "enabled" : "disabled"}`);
  const s = await status();
  if (s.local) {
    console.log(
      `  Local:               ${formatBytes(s.local.size)}, modified ${formatAgo(s.local.modifiedAt)}`
    );
  } else {
    console.log(`  Local:               (no DB file yet)`);
  }
  if (s.remote) {
    console.log(
      `  Remote:              ${formatBytes(s.remote.size)}, modified ${formatAgo(s.remote.modifiedAt)}`
    );
  } else {
    console.log(`  Remote:              (no object — push to create)`);
  }
}

function runEnable() {
  if (!hasSyncConfig()) {
    return abort("no sync config for the active project — run `bertrand sync onboard` first");
  }
  patchConfig({ sync: { enabled: true } });
  console.log("Sync auto-triggers enabled. Pull-on-launch and push-on-session-end will fire.");
}

function runInvite() {
  const cfg = loadSyncConfig();
  if (!cfg) {
    return abort("no sync config for the active project — run `bertrand sync onboard` first");
  }
  const active = resolveActiveProject();
  const invite = encodeInvite(cfg, { slug: active.slug, name: active.name });
  console.log(
    "Sensitive: this bundle contains a Supabase service_role token AND the project's encryption key."
  );
  console.log(
    "Transmit only over a secure channel (Signal, iMessage, AirDrop). Treat like an SSH private key.\n"
  );
  console.log(`Project: ${active.slug} (${active.name})\n`);
  console.log(invite);
  console.log("\nOn the other machine:");
  console.log(`  bertrand sync ${invite.slice(0, 32)}…`);
  console.log(`  (creates the project locally, saves config, runs first pull)`);
}

async function runBootstrap(invite: string) {
  console.log("Importing project from invite…");
  const result = await bootstrapFromInvite(invite);
  if (!result.ok) {
    if (result.reason === "pull-failed") {
      console.error(`Pull failed: ${result.error}`);
      console.error(`(Config is saved, so you can fix and re-run \`bertrand sync pull\`.)`);
      process.exit(1);
    }
    return abort(result.error);
  }
  const active = resolveActiveProject();
  console.log(
    `Created project "${result.project.slug}" (${result.project.name}) and wrote ${active.syncEnv}.`,
  );
  if (result.pulled) {
    console.log(
      `✓ Done (${formatBytes(result.bytes)} in ${result.durationMs}ms). Run \`bertrand\` to start.`,
    );
  } else {
    console.log(`✓ Config saved, but no remote object yet — nothing to pull.`);
    console.log(`  Run \`bertrand sync push\` on the source machine first.`);
  }
}

function runDisable() {
  patchConfig({ sync: { enabled: false } });
  console.log(
    "Sync auto-triggers disabled. Credentials still in place — re-enable any time with `bertrand sync enable`."
  );
  console.log("Manual `bertrand sync push` / `pull` still work while disabled.");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(2)}MB`;
}

register("sync", async (args) => {
  const sub = args[0];
  // Accept a paste-as-positional invite bundle: `bertrand sync bertrand-sync://...`
  if (sub && isInvite(sub)) {
    await runBootstrap(sub);
    return;
  }
  // Every other subcommand accepts `--project <slug>` to override the active.
  const { slug: projectOverride, rest } = extractProjectFlag(args.slice(1));
  applyProjectOverride(projectOverride);
  switch (sub) {
    case "push":
      await runPush();
      return;
    case "pull":
      await runPull(rest);
      return;
    case "status":
      await runStatus();
      return;
    case "onboard":
      await runOnboard();
      return;
    case "invite":
      runInvite();
      return;
    case "enable":
      runEnable();
      return;
    case "disable":
      runDisable();
      return;
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return;
    default:
      console.error(`Unknown subcommand: ${sub}`);
      printUsage();
      process.exit(1);
  }
});
