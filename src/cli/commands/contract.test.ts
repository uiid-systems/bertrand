import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const runtimeDir = mkdtempSync(join(tmpdir(), "bertrand-contract-"));
const { _setRuntimeDir, contractMarkerPath, markContractSent, writeAdoptionMarker } =
  await import("@/hooks/runtime");
_setRuntimeDir(runtimeDir);

const { resolveContractTarget } = await import("./contract");

const CID = "11111111-1111-4111-8111-111111111111";

describe("resolveContractTarget", () => {
  test("prefers --session-id, which is what every hook passes", () => {
    expect(
      resolveContractTarget(["--session-id", "sess_flag"], {
        BERTRAND_SESSION: "sess_env",
      }),
    ).toMatchObject({ sessionId: "sess_flag" });
  });

  test("accepts --session-id=value", () => {
    expect(resolveContractTarget(["--session-id=sess_inline"], {})).toMatchObject({
      sessionId: "sess_inline",
    });
  });

  test("falls back to BERTRAND_SESSION for a launched claude", () => {
    expect(resolveContractTarget([], { BERTRAND_SESSION: "sess_env" })).toMatchObject({
      sessionId: "sess_env",
    });
  });

  test("keys the marker by conversation, not session, when both are known", () => {
    // Must match the hook's `contract-sent-${cid:-$sid}` or the two would write
    // different markers and the contract would be delivered in full twice.
    expect(
      resolveContractTarget([], {
        BERTRAND_SESSION: "sess_env",
        BERTRAND_CLAUDE_ID: CID,
      }),
    ).toEqual({ sessionId: "sess_env", conversationId: CID });
  });

  test("keys the marker by session id when there is no conversation", () => {
    expect(resolveContractTarget(["--session-id", "sess_only"], {})).toEqual({
      sessionId: "sess_only",
      conversationId: "sess_only",
    });
  });

  test("resolves an adopted session through its marker", () => {
    writeAdoptionMarker(CID, { sessionId: "sess_adopted" });

    // The whole point: an adopted claude has no BERTRAND_* env at all, because
    // adoption cannot inject env into a process that is already running.
    // The session id is the whole answer — the marker used to carry a project
    // slug as well, so the row could be looked up in the right database.
    expect(resolveContractTarget([], { CLAUDE_CODE_SESSION_ID: CID })).toEqual({
      sessionId: "sess_adopted",
      conversationId: CID,
    });
  });

  test("returns null for a claude that was never adopted", () => {
    expect(
      resolveContractTarget([], {
        CLAUDE_CODE_SESSION_ID: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBeNull();
  });

  test("returns null outside claude entirely", () => {
    expect(resolveContractTarget([], {})).toBeNull();
  });
});

describe("markContractSent", () => {
  test("writes the marker the UserPromptSubmit hook looks for", () => {
    const cid = "33333333-3333-4333-8333-333333333333";
    markContractSent(cid);

    expect(existsSync(contractMarkerPath(cid))).toBe(true);
    expect(contractMarkerPath(cid)).toBe(join(runtimeDir, `contract-sent-${cid}`));
  });
});
