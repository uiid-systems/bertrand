import { describe, test, expect } from "bun:test";
import { encodeInvite, decodeInvite, isInvite } from "./invite";
import type { SyncConfig } from "./config";

const SAMPLE_CONFIG: SyncConfig = {
  supabaseUrl: "https://abcdefghij1234567890.supabase.co",
  supabaseServiceKey: "eyJ.signed-jwt.signature",
  bucket: "bertrand",
  objectKey: "projects/acme/bertrand.db.enc",
  encryptionKey: "k1XyhPTwjUelDqp4WfPGn5J6tBxKMrJWTL4OGZ3UAGI=",
  clientName: "bertrand-laptop",
};

const SAMPLE_PROJECT = { slug: "acme", name: "Acme Corp" };

describe("encodeInvite / decodeInvite (v2 roundtrip)", () => {
  test("roundtrips config and project metadata", () => {
    const invite = encodeInvite(SAMPLE_CONFIG, SAMPLE_PROJECT);
    expect(isInvite(invite)).toBe(true);

    const decoded = decodeInvite(invite);
    expect(decoded.project).toEqual(SAMPLE_PROJECT);
    expect(decoded.config).toEqual({
      supabaseUrl: SAMPLE_CONFIG.supabaseUrl,
      supabaseServiceKey: SAMPLE_CONFIG.supabaseServiceKey,
      bucket: SAMPLE_CONFIG.bucket,
      objectKey: SAMPLE_CONFIG.objectKey,
      encryptionKey: SAMPLE_CONFIG.encryptionKey,
    });
    // clientName is intentionally not transmitted — receiving machine
    // generates its own (hostname-based).
    expect("clientName" in decoded.config).toBe(false);
  });

  test("invite string starts with the scheme prefix", () => {
    const invite = encodeInvite(SAMPLE_CONFIG, SAMPLE_PROJECT);
    expect(invite.startsWith("bertrand-sync://")).toBe(true);
  });
});

describe("decodeInvite — error paths", () => {
  test("rejects strings missing the scheme prefix", () => {
    expect(() => decodeInvite("just-some-text")).toThrow(/must start with/);
  });

  test("rejects malformed base64/JSON payloads", () => {
    expect(() => decodeInvite("bertrand-sync://not-base64-or-json")).toThrow(/malformed/);
  });

  test("hard-cutover: rejects v1 bundles even when otherwise well-formed", () => {
    const v1Bundle = {
      v: 1,
      url: SAMPLE_CONFIG.supabaseUrl,
      key: SAMPLE_CONFIG.supabaseServiceKey,
      bucket: SAMPLE_CONFIG.bucket,
      obj: SAMPLE_CONFIG.objectKey,
      ek: SAMPLE_CONFIG.encryptionKey,
    };
    const encoded =
      "bertrand-sync://" +
      Buffer.from(JSON.stringify(v1Bundle), "utf8").toString("base64url");

    expect(() => decodeInvite(encoded)).toThrow(/version 1 is not supported/);
  });

  test("missing project slug field is rejected", () => {
    const incomplete = {
      v: 2,
      url: SAMPLE_CONFIG.supabaseUrl,
      key: SAMPLE_CONFIG.supabaseServiceKey,
      bucket: SAMPLE_CONFIG.bucket,
      obj: SAMPLE_CONFIG.objectKey,
      ek: SAMPLE_CONFIG.encryptionKey,
      // psl: missing
      pn: "Acme",
    };
    const encoded =
      "bertrand-sync://" +
      Buffer.from(JSON.stringify(incomplete), "utf8").toString("base64url");

    expect(() => decodeInvite(encoded)).toThrow(/missing required field: psl/);
  });

  test("missing config field is rejected", () => {
    const incomplete = {
      v: 2,
      // url: missing
      key: SAMPLE_CONFIG.supabaseServiceKey,
      bucket: SAMPLE_CONFIG.bucket,
      obj: SAMPLE_CONFIG.objectKey,
      ek: SAMPLE_CONFIG.encryptionKey,
      psl: "acme",
      pn: "Acme",
    };
    const encoded =
      "bertrand-sync://" +
      Buffer.from(JSON.stringify(incomplete), "utf8").toString("base64url");

    expect(() => decodeInvite(encoded)).toThrow(/missing required field: url/);
  });
});

describe("isInvite", () => {
  test("recognizes well-formed invite strings", () => {
    expect(isInvite("bertrand-sync://anything")).toBe(true);
  });

  test("rejects non-string inputs", () => {
    expect(isInvite(undefined as unknown as string)).toBe(false);
    expect(isInvite(null as unknown as string)).toBe(false);
    expect(isInvite(123 as unknown as string)).toBe(false);
  });

  test("rejects strings without the scheme", () => {
    expect(isInvite("https://example.com")).toBe(false);
    expect(isInvite("")).toBe(false);
  });
});
