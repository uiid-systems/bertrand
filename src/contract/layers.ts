import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { buildContract } from "@/contract/template";
import { buildSiblingContext } from "@/contract/context";
import { buildResumeDigest } from "@/contract/history";
import { helpText } from "@/cli/help";
import { isContextRecallEnabled } from "@/lib/config";
import { paths } from "@/lib/paths";

/** One named section of injected context, named so its cost can be logged. */
export interface ContextLayer {
  name: string;
  text: string;
}

/**
 * The context sections that follow the rules in a full contract. One list, so
 * every path that builds a contract — the TUI launch, resume, the dashboard,
 * the hook — injects the same thing.
 *
 * `conversationId` is the conversation the contract is for; the resume digest
 * describes the session's *other* conversations.
 */
export function contractLayers(
  sessionId: string,
  conversationId?: string,
): ContextLayer[] {
  return [
    { name: "cli", text: helpText({ agent: true }) },
    {
      name: "history",
      text: isContextRecallEnabled() ? buildResumeDigest(sessionId, conversationId) : "",
    },
    { name: "siblings", text: buildSiblingContext(sessionId) },
  ];
}

export function buildSessionContract(
  sessionName: string,
  sessionId: string,
  conversationId?: string,
): string {
  return buildContract(
    sessionName,
    ...contractLayers(sessionId, conversationId).map((l) => l.text),
  );
}

export interface ContextDelivery {
  sessionId?: string;
  conversationId: string;
  /** argv: system prompt at spawn. full / reminder: the hook or /bertrand. */
  delivery: "argv" | "full" | "reminder";
  bytes: number;
  /** Bytes per named layer, where the caller knows them. */
  layers?: Record<string, number>;
  /** Session slugs recall pointed to. */
  recalled?: string[];
}

/**
 * Append one delivery to `paths.contextLog` — the cost side of
 * docs/context-budget.md Tier 3: injected bytes × the requests that follow.
 * Best-effort: measurement must never break a contract delivery.
 */
export function logContextDelivery(entry: ContextDelivery): void {
  try {
    mkdirSync(dirname(paths.contextLog), { recursive: true });
    appendFileSync(
      paths.contextLog,
      JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n",
    );
  } catch {
    // Best-effort by design.
  }
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
