import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const MAGIC = Buffer.from("BTRD1", "ascii");

/**
 * Wire format for an encrypted Bertrand DB blob:
 *
 *   [ 5 bytes "BTRD1" ][ 12 bytes IV ][ ciphertext ][ 16 bytes GCM tag ]
 *
 * The magic prefix lets us refuse to decrypt unrelated files (a corrupt
 * download, an accidentally-uploaded plaintext .db) before they cost us
 * a misleading "bad key" error. Keys are 32 bytes (base64-encoded in the
 * env file) — anything else throws here, not deep in node's crypto.
 */

function parseKey(base64Key: string): Buffer {
  const buf = Buffer.from(base64Key, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `BERTRAND_ENCRYPTION_KEY must decode to 32 bytes (got ${buf.length}). ` +
        `Generate one with: openssl rand -base64 32`
    );
  }
  return buf;
}

export function generateKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

export function encrypt(plaintext: Buffer, base64Key: string): Buffer {
  const key = parseKey(base64Key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, ciphertext, tag]);
}

export function decrypt(blob: Buffer, base64Key: string): Buffer {
  if (blob.length < MAGIC.length + IV_LEN + TAG_LEN) {
    throw new Error("encrypted blob too small to be valid");
  }
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error(
      "not a bertrand encrypted blob (magic prefix mismatch). " +
        "Did you upload a plaintext .db file by mistake?"
    );
  }
  const key = parseKey(base64Key);
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ciphertext = blob.subarray(MAGIC.length + IV_LEN, blob.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
