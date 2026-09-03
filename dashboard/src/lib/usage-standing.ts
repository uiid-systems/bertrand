import type { SessionStatsRow } from "../api/types";
import { formatTokens } from "./format";

/**
 * How heavy a session is in token terms, relative to its peers.
 *
 * Severity here is relative, never absolute. "100K output tokens" means
 * nothing on its own — whether that is a lot depends entirely on how the user
 * works. So a session is ranked against every other session bertrand knows and
 * the badge colours that standing, which also means the scale self-calibrates
 * as more sessions accumulate.
 */
export type Standing = {
  color: "neutral" | "green" | "yellow" | "red";
  /** Spelled out on hover — the colour carries it at a glance. */
  title: string;
};

/**
 * Only sessions that captured output are meaningful peers: a zero is a
 * session predating usage capture, not a genuinely light one, and letting
 * those in would drag every real session up the scale.
 */
export function usagePeers(
  allStats: Record<string, SessionStatsRow> | undefined,
): number[] {
  return Object.values(allStats ?? {})
    .map((s) => s.outputTokens)
    .filter((n) => n > 0);
}

export function standingFor(
  outputTokens: number,
  peers: readonly number[],
): Standing {
  const others = peers.length - 1; // exclude this session
  if (others < 2) {
    return {
      color: "neutral",
      title: "Not enough sessions to compare against yet",
    };
  }

  const below = peers.filter((p) => p < outputTokens).length;
  const percentile = below / others;

  // Even thirds, so every session lands on a colour: red heavy, yellow
  // typical, green light. A neutral band would leave the middle looking
  // uncoloured, which reads as "no data" rather than "unremarkable".
  const color: Standing["color"] =
    percentile >= 2 / 3 ? "red" : percentile >= 1 / 3 ? "yellow" : "green";

  const rank = others + 1 - below; // 1 = heaviest
  return {
    color,
    title: `${formatTokens(outputTokens)} output tokens — rank ${rank} of ${peers.length} sessions`,
  };
}
