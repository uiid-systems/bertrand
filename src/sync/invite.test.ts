import { describe, test, expect } from "bun:test";
import { encodeInvite, decodeInvite, isInvite } from "./invite";
import type { SyncConfig } from "./config";

const SAMPLE_CONFIG: SyncConfig = {
  supabaseUrl: "https://abcdefghij1234567890.supabase.co",
  supabaseServiceKey: "eyJ.signed-jwt.signature",
  bucket: "bertrand",
  objectKey: "bertrand.db.enc",
  encryptionKey: "k1XyhPTwjUelDqp4WfPGn5J6tBxKMrJWTL4OGZ3UAGI=",
  clientName: "bertrand-laptop",
};

describe("encodeInvite / decodeInvite (v3 roundtrip)", () => {
  test("roundtrips the credentials, and carries nothing else", () => {
    const invite = encodeInvite(SAMPLE_CONFIG);
    expect(isInvite(invite)).toBe(true);

    const decoded = decodeInvite(invite);
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
    // A v2 bundle also carried a project slug and display name, so the
    // receiving machine could create the named project the data belonged to.
    // A bundle now names one database and importing it means "pull that here".
    expect(Object.keys(decoded)).toEqual(["config"]);
  });

  test("invite string starts with the scheme prefix", () => {
    const invite = encodeInvite(SAMPLE_CONFIG);
    expect(invite.startsWith("bertrand-sync://")).toBe(true);
  });
});

describe("decodeInvite — error paths", () => {
  const bundle = (fields: Record<string, unknown>): string =>
    "bertrand-sync://" +
    Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");

  const CREDENTIALS = {
    url: SAMPLE_CONFIG.supabaseUrl,
    key: SAMPLE_CONFIG.supabaseServiceKey,
    bucket: SAMPLE_CONFIG.bucket,
    obj: SAMPLE_CONFIG.objectKey,
    ek: SAMPLE_CONFIG.encryptionKey,
  };

  test("rejects strings missing the scheme prefix", () => {
    expect(() => decodeInvite("just-some-text")).toThrow(/must start with/);
  });

  test("rejects malformed base64/JSON payloads", () => {
    expect(() => decodeInvite("bertrand-sync://not-base64-or-json")).toThrow(/malformed/);
  });

  test("hard-cutover: rejects v1 bundles even when otherwise well-formed", () => {
    expect(() => decodeInvite(bundle({ v: 1, ...CREDENTIALS }))).toThrow(
      /version 1 is not supported/,
    );
  });

  test("hard-cutover: rejects v2 bundles, which describe a project", () => {
    // A v2 bundle names a registry row and a per-project database this machine
    // has no way to create, so there is nothing sensible to do with its slug.
    expect(() =>
      decodeInvite(bundle({ v: 2, ...CREDENTIALS, psl: "acme", pn: "Acme" })),
    ).toThrow(/version 2 is not supported/);
  });

  test("missing config field is rejected", () => {
    const { url: _url, ...withoutUrl } = CREDENTIALS;
    expect(() => decodeInvite(bundle({ v: 3, ...withoutUrl }))).toThrow(
      /missing required field: url/,
    );
  });

  test("missing encryption key is rejected", () => {
    const { ek: _ek, ...withoutKey } = CREDENTIALS;
    expect(() => decodeInvite(bundle({ v: 3, ...withoutKey }))).toThrow(
      /missing required field: ek/,
    );
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
