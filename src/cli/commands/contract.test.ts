import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as schema from "@/db/schema";
import { _setDb } from "@/db/client";
import { _setRootDir, paths } from "@/lib/paths";

const runtimeDir = mkdtempSync(join(tmpdir(), "bertrand-contract-"));
const { _setRuntimeDir, contractMarkerPath, markContractSent, writeAdoptionMarker } =
  await import("@/hooks/runtime");
_setRuntimeDir(runtimeDir);
// Config (the contextRecall flag) and the delivery log live under the root.
_setRootDir(runtimeDir);

const sqlite = new Database(join(runtimeDir, "test.db"));
sqlite.exec("PRAGMA foreign_keys = ON");
_setDb(drizzle(sqlite, { schema }));
migrate(drizzle(sqlite), {
  migrationsFolder: join(import.meta.dir, "..", "..", "db", "migrations"),
});

const { contractDelivery, renderContract, resolveContractTarget } = await import("./contract");
const { createSession, updateSession } = await import("@/db/queries/sessions");
const { createConversation } = await import("@/db/queries/conversations");
const { insertEvent } = await import("@/db/queries/events");

const CID = "11111111-1111-4111-8111-111111111111";

describe("resolveContractTarget", () => {
  test("prefers --session-id, which is what every hook passes", () => {
    expect(
      resolveContractTarget(["--session-id", "sess_flag"], {
        BERTRAND_SESSION: "sess_env",
      }),
    ).toMatchObject({ sessionId: "sess_flag" });
  });

  test("takes the conversation from --conversation-id over the env", () => {
    // The hook passes its own `${cid:-$sid}`, which for an adopted claude comes
    // from the payload — the env may not carry it at all.
    expect(
      resolveContractTarget(["--session-id", "sess_flag", "--conversation-id", "conv_flag"], {
        BERTRAND_CLAUDE_ID: CID,
      }),
    ).toEqual({ sessionId: "sess_flag", conversationId: "conv_flag" });
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

describe("contractDelivery", () => {
  test("/bertrand gets the full contract only where nothing delivered it yet", () => {
    // An adopted claude the hook skipped: unmarked, so full — then marked.
    const fresh = "44444444-4444-4444-8444-444444444444";
    expect(contractDelivery(["--mark-sent"], fresh)).toBe("full");

    // A launched or already-attached claude: marked before /bertrand runs.
    markContractSent(fresh);
    expect(contractDelivery(["--mark-sent"], fresh)).toBe("reminder");

    // The hook's own first-prompt call ignores the marker; --short never does.
    expect(contractDelivery([], fresh)).toBe("full");
    expect(contractDelivery(["--short"], "55555555-5555-4555-8555-555555555555")).toBe("reminder");
  });
});

describe("renderContract", () => {
  const setRecall = (on: boolean) =>
    writeFileSync(join(runtimeDir, "config.json"), JSON.stringify({ contextRecall: on }));
  const render = (args: string[], conversationId: string, prompt = "") => {
    let out = "";
    renderContract(args, { sessionId: self.id, conversationId }, prompt, (t) => (out += t));
    return out;
  };
  const lastLog = () =>
    JSON.parse(readFileSync(paths.contextLog, "utf-8").trim().split("\n").at(-1)!);

  let self: ReturnType<typeof createSession>;
  beforeAll(() => {
    self = createSession({ slug: "render-self" });
    createConversation({ id: "render-earlier", sessionId: self.id });
    insertEvent({ sessionId: self.id, conversationId: "render-earlier", event: "user.prompt", meta: { prompt: "an earlier ask" } });
    insertEvent({ sessionId: self.id, conversationId: "render-earlier", event: "assistant.message", meta: { text: "an earlier answer" } });

    const flaky = createSession({ slug: "flaky-upload" });
    updateSession(flaky.id, { summary: "the s3 upload retries are flaky in staging → added jittered backoff" });
    for (let i = 0; i < 6; i++) createSession({ slug: `render-filler-${i}` });
  });

  test("flag off: the plain contract and reminder, logged with their layers", () => {
    setRecall(false);
    const full = render([], "render-off", "why are the s3 upload retries flaky");
    expect(full).toContain("## bertrand CLI");
    expect(full).not.toContain("## Earlier in this session");
    expect(full).not.toContain("## Possibly related");
    expect(lastLog()).toMatchObject({ delivery: "full", layers: { history: 0, recall: 0 }, recalled: [] });

    const short = render(["--short"], "render-off", "why are the s3 upload retries flaky");
    expect(short).toStartWith("Reminder — you are in bertrand session render-self");
    expect(short).not.toContain("## Possibly related");
  });

  test("flag on: a reminder carries recall once per conversation", () => {
    setRecall(true);
    const prompt = "why are the s3 upload retries flaky";
    const first = render(["--short"], "render-on", prompt);
    expect(first).toContain("## Possibly related past sessions");
    expect(first).toContain("- flaky-upload (");
    expect(lastLog()).toMatchObject({ delivery: "reminder", recalled: ["flaky-upload"] });

    // Already in this conversation's history: not pointed to again.
    expect(render(["--short"], "render-on", prompt)).not.toContain("## Possibly related");
    // A different conversation hasn't seen it.
    expect(render(["--short"], "render-other", prompt)).toContain("- flaky-upload (");
  });

  test("flag on: a full delivery adds the digest and queries the transcript's prompts", () => {
    setRecall(true);
    // The adopting prompt says nothing; the prompt before adoption, only in
    // the transcript, carries the subject.
    const transcript = join(runtimeDir, "adopted.jsonl");
    writeFileSync(
      transcript,
      JSON.stringify({ type: "user", message: { role: "user", content: "the s3 upload retries are flaky again" } }) + "\n",
    );
    const full = render(["--transcript-path", transcript], "render-adopted", "ok go ahead");
    expect(full).toContain("## Earlier in this session");
    expect(full).toContain('"an earlier ask → an earlier answer"');
    expect(full).toContain("- flaky-upload (");
  });

  test("--mark-sent marks only after a full contract was written", () => {
    setRecall(false);
    expect(() =>
      renderContract(["--mark-sent"], { sessionId: self.id, conversationId: "render-fail" }, "", () => {
        throw new Error("EPIPE");
      }),
    ).toThrow();
    expect(existsSync(contractMarkerPath("render-fail"))).toBe(false);

    expect(render(["--mark-sent"], "render-fail")).toContain("## bertrand CLI");
    expect(existsSync(contractMarkerPath("render-fail"))).toBe(true);
    // Marked now, so /bertrand gets the rules only.
    expect(render(["--mark-sent"], "render-fail")).toStartWith("Reminder");
  });

  test("an unknown session writes nothing", () => {
    let wrote = false;
    renderContract([], { sessionId: "nope", conversationId: "x" }, "", () => (wrote = true));
    expect(wrote).toBe(false);
  });
});
