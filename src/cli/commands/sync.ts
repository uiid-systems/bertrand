import { hostname } from "os";
import { register } from "@/cli/router";
import { hasSyncConfig, loadSyncConfig, saveSyncConfig } from "@/sync/config";
import { push, pull, status } from "@/sync/engine";
import { generateKeyBase64 } from "@/sync/crypto";
import { encodeInvite, decodeInvite, isInvite } from "@/sync/invite";
import { paths } from "@/lib/paths";
import { formatAgo } from "@/lib/format";
import { isSyncEnabled, patchConfig } from "@/lib/config";

function printUsage() {
  console.log(`
bertrand sync — replicate your local DB to Supabase Storage (opt-in)

Usage:
  bertrand sync onboard           Interactive: configure Supabase + bucket + encryption key
  bertrand sync invite            Print a paste-able bundle for another machine
  bertrand sync <bundle>          One-liner: decode bundle, save config, pull
  bertrand sync push              VACUUM → encrypt → upload
  bertrand sync pull [--force]    Download → decrypt → atomic-replace (refuses if active)
  bertrand sync status            Local + remote object size and timestamps
  bertrand sync enable            Turn auto-triggers on (assumes onboard already ran)
  bertrand sync disable           Turn auto-triggers off without deleting credentials

Cross-machine setup:
  Machine A:  bertrand sync invite
              → bertrand-sync://eyJ…   (transmit via Signal/iMessage/AirDrop — sensitive)
  Machine B:  bertrand sync bertrand-sync://eyJ…
              → onboards, pulls, ready
`.trim());
}

function abort(reason: string) {
  console.error(`Aborted: ${reason}`);
  process.exit(1);
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
  const existing = loadSyncConfig();
  if (existing) {
    console.log(`Existing config at ${paths.syncEnv}:`);
    console.log(`  SUPABASE_URL:           ${existing.supabaseUrl}`);
    console.log(`  SUPABASE_SERVICE_KEY:   ${existing.supabaseServiceKey.slice(0, 12)}…`);
    console.log(`  BERTRAND_SYNC_BUCKET:   ${existing.bucket}`);
    console.log(`  BERTRAND_SYNC_OBJECT:   ${existing.objectKey}`);
    console.log(`  BERTRAND_ENCRYPTION_KEY: ${existing.encryptionKey.slice(0, 8)}… (hidden)`);
    console.log(`  BERTRAND_CLIENT_NAME:   ${existing.clientName}`);
    console.log(`\nDelete ${paths.syncEnv} and re-run to start over.`);
    return;
  }

  console.log(`Bertrand sync setup — Supabase Storage\n`);
  console.log(`In the Supabase dashboard (app.supabase.com):`);
  console.log(`  1. Create or pick a project`);
  console.log(`  2. Settings → General: copy the Project ID (the 20-char lowercase string`);
  console.log(`     shown under "Reference ID" — looks like "xxxxxxxxxxxxxxxxxxxx")`);
  console.log(`  3. Settings → API: copy the service_role key (NOT the anon key — service_role`);
  console.log(`     is below it and warns "keep secret")`);
  console.log(`  4. Storage → New bucket: name it "bertrand", PRIVATE (uncheck "Public bucket")\n`);

  const projectId = await prompt("Project ID");
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
  const objectKey = await prompt("Object key", { default: "bertrand.db.enc" });

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
    console.log(`other machine that should be able to pull this DB:\n`);
    console.log(`  ${encryptionKey}\n`);
    console.log(`Hit ENTER to confirm you've saved it.`);
    await prompt("");
  }

  saveSyncConfig({ supabaseUrl, supabaseServiceKey, bucket, objectKey, encryptionKey, clientName });
  patchConfig({ sync: { enabled: true } });
  console.log(`Wrote ${paths.syncEnv} (mode 0600). Sync auto-triggers enabled.`);
  console.log(`\nNext:`);
  console.log(`  bertrand sync push      Send your current local DB to Supabase`);
  console.log(`  bertrand sync status    See sizes and timestamps`);
  console.log(`\nOn another machine: paste the same SUPABASE_URL, a fresh SERVICE_KEY (you can reuse),`);
  console.log(`the same bucket and object key, and the SAME encryption key. Then \`bertrand sync pull\`.`);
}

async function runPush() {
  if (!hasSyncConfig()) return abort("no sync config — run `bertrand sync onboard`");
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
  if (!hasSyncConfig()) return abort("no sync config — run `bertrand sync onboard`");
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
  if (!hasSyncConfig()) {
    console.log("Sync is not configured. Run `bertrand sync onboard` to set up.");
    return;
  }
  console.log(`Sync status (${paths.syncEnv}):`);
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
    return abort("no sync config — run `bertrand sync onboard` first");
  }
  patchConfig({ sync: { enabled: true } });
  console.log("Sync auto-triggers enabled. Pull-on-launch and push-on-session-end will fire.");
}

function runInvite() {
  const cfg = loadSyncConfig();
  if (!cfg) {
    return abort("no sync config — run `bertrand sync onboard` first");
  }
  const invite = encodeInvite(cfg);
  console.log(
    "Sensitive: this bundle contains a Supabase service_role token AND your DB encryption key."
  );
  console.log(
    "Transmit only over a secure channel (Signal, iMessage, AirDrop). Treat like an SSH private key.\n"
  );
  console.log(invite);
  console.log("\nOn the other machine:");
  console.log(`  bertrand sync ${invite.slice(0, 32)}…`);
}

async function runBootstrap(invite: string) {
  if (hasSyncConfig()) {
    return abort(
      `sync config already exists at ${paths.syncEnv}. ` +
        `Delete it first if you really want to overwrite: \`rm ${paths.syncEnv}\``
    );
  }
  let decoded: ReturnType<typeof decodeInvite>;
  try {
    decoded = decodeInvite(invite);
  } catch (e) {
    return abort(e instanceof Error ? e.message : String(e));
  }
  const clientName = `bertrand-${hostname()}`;
  saveSyncConfig({ ...decoded, clientName });
  patchConfig({ sync: { enabled: true } });
  console.log(`Wrote ${paths.syncEnv} (mode 0600). Auto-triggers enabled.`);
  console.log(`Pulling…`);
  const result = await pull();
  if (result.ok) {
    if (result.pulled) {
      console.log(`✓ Done (${formatBytes(result.bytes)} in ${result.durationMs}ms). Run \`bertrand\` to start.`);
    } else {
      console.log(`✓ Config saved, but no remote object yet — nothing to pull.`);
      console.log(`  Run \`bertrand sync push\` on the source machine first.`);
    }
  } else {
    console.error(`Pull failed: ${result.error}`);
    console.error(`(Config is saved, so you can fix and re-run \`bertrand sync pull\`.)`);
    process.exit(1);
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
  switch (sub) {
    case "push":
      await runPush();
      return;
    case "pull":
      await runPull(args.slice(1));
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
