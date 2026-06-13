/**
 * One-off verification: compare local row counts against the LAST PUSHED
 * snapshot in Supabase Storage. Download → decrypt → open with bun:sqlite
 * → count rows per table. Run after `bertrand sync push`.
 *
 * Usage:
 *   bun run scripts/sync-verify.mjs
 */
import { Database as BunDatabase } from "bun:sqlite";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createDecipheriv } from "node:crypto";

const SYNC_ENV = join(homedir(), ".bertrand", "sync.env");
const LOCAL_DB = join(homedir(), ".bertrand", "bertrand.db");
const SCRATCH = join(homedir(), ".bertrand", "bertrand.db.verify");

if (!existsSync(SYNC_ENV)) {
  console.error(`No ${SYNC_ENV}. Run 'bertrand sync onboard' first.`);
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(SYNC_ENV, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    })
);

const TABLES = [
  "groups",
  "labels",
  "sessions",
  "session_labels",
  "conversations",
  "events",
  "worktree_associations",
  "session_stats",
];

const MAGIC = Buffer.from("BTRD1", "ascii");
const IV_LEN = 12;
const TAG_LEN = 16;

function decrypt(blob, base64Key) {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("not a bertrand encrypted blob");
  }
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(MAGIC.length + IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const local = new BunDatabase(LOCAL_DB, { readonly: true });
const localCounts = Object.fromEntries(
  TABLES.map((t) => {
    try {
      const row = local.query(`SELECT COUNT(*) AS n FROM ${t}`).get();
      return [t, row?.n ?? 0];
    } catch {
      return [t, "—"];
    }
  })
);
local.close();

console.log("Downloading remote object…");
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await supabase.storage
  .from(env.BERTRAND_SYNC_BUCKET)
  .download(env.BERTRAND_SYNC_OBJECT || "bertrand.db.enc");

if (error || !data) {
  console.error(`Remote object missing or unreachable: ${error?.message ?? "no data"}`);
  process.exit(1);
}

const ciphertext = Buffer.from(await data.arrayBuffer());
console.log(`Downloaded ${(ciphertext.length / 1024).toFixed(1)} KB encrypted.`);

console.log("Decrypting locally…");
const plaintext = decrypt(ciphertext, env.BERTRAND_ENCRYPTION_KEY);
writeFileSync(SCRATCH, plaintext);

const remote = new BunDatabase(SCRATCH, { readonly: true });
const remoteCounts = Object.fromEntries(
  TABLES.map((t) => {
    try {
      const row = remote.query(`SELECT COUNT(*) AS n FROM ${t}`).get();
      return [t, row?.n ?? 0];
    } catch {
      return [t, "—"];
    }
  })
);
remote.close();
unlinkSync(SCRATCH);

console.log(`\nRow counts: local vs. last push to Supabase\n`);
console.log("table                       local   remote   match");
console.log("─".repeat(60));
for (const t of TABLES) {
  const l = String(localCounts[t]);
  const r = String(remoteCounts[t]);
  const match = l === r ? "✓" : "✗";
  console.log(`${t.padEnd(26)}  ${l.padStart(5)}   ${r.padStart(6)}   ${match}`);
}
