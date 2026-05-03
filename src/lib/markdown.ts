/**
 * Normalize markdown captured from terminal-typed sources before storage.
 *
 * AskUserQuestion notes arrive with `\r` line endings from the terminal —
 * unambiguously a terminal artifact, always safe to convert. We deliberately
 * do not try to repair flat-pasted code fences (e.g. ```text``` on one line):
 * any heuristic risks breaking valid ```lang fences, and a pure-regex repair
 * can't recover content that lacks line breaks anyway.
 *
 * Normalize once at write-time so every reader can assume clean markdown.
 */
export function normalizeMarkdown(input: string): string {
  return input.replace(/\r\n?/g, "\n");
}

/**
 * Apply markdown normalization to known markdown-bearing fields per event
 * type. Unknown event types pass through untouched.
 */
export function normalizeEventMeta(
  eventName: string,
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return meta;

  switch (eventName) {
    case "session.recap":
      return mapStringField(meta, "recap", normalizeMarkdown);

    case "assistant.message":
      return mapStringField(meta, "text", normalizeMarkdown);

    case "session.answered":
      return normalizeAnsweredMeta(meta);

    default:
      return meta;
  }
}

function mapStringField(
  meta: Record<string, unknown>,
  key: string,
  fn: (s: string) => string,
): Record<string, unknown> {
  const value = meta[key];
  if (typeof value !== "string") return meta;
  return { ...meta, [key]: fn(value) };
}

function normalizeAnsweredMeta(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...meta };

  const answers = meta.answers;
  if (answers && typeof answers === "object" && !Array.isArray(answers)) {
    out.answers = Object.fromEntries(
      Object.entries(answers as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === "string" ? normalizeMarkdown(v) : v,
      ]),
    );
  }

  const annotations = meta.annotations;
  if (annotations && typeof annotations === "object" && !Array.isArray(annotations)) {
    out.annotations = Object.fromEntries(
      Object.entries(annotations as Record<string, unknown>).map(([k, v]) => {
        if (!v || typeof v !== "object") return [k, v];
        const a = v as Record<string, unknown>;
        if (typeof a.notes !== "string") return [k, v];
        return [k, { ...a, notes: normalizeMarkdown(a.notes) }];
      }),
    );
  }

  return out;
}
