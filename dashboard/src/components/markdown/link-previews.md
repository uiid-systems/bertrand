# Markdown Link Previews — Spec

Status: design draft, not started
Owner: TBD
Component touched: `dashboard/src/components/markdown/`

This document captures the patterns surveyed and the proposed implementation
for adding rich previews (chip + hover card) to links rendered by the
markdown component.

---

## Industry survey

Four density tiers, plus a perpendicular split between **generic OG previews**
and **entity-aware autolinks**.

### Density tiers (smallest to largest)

1. **Inline chip** — favicon + truncated title rendered as a pill. Notion's
   "Mention" paste option, Linear's auto-mention when you paste a
   Linear/Figma/GitHub URL. Stays in the text flow.
2. **Hover card** — link looks plain, but hovering pops a tooltip with
   metadata (title, description, status, avatar). GitHub's hovercards on
   `#123`, `@user`, repo refs, commit SHAs are the canonical example.
3. **Bookmark card** — block-level card with favicon, title, description,
   optional thumbnail. Notion's "Bookmark" paste option, Slack/Discord
   unfurls. Smaller footprint than a full embed.
4. **Full embed** — large card with hero image, oEmbed iframe, or live
   preview. Notion "Embed", Twitter/X OG cards, Figma/YouTube embeds.

### Entity-aware vs. generic

- **Generic OG**: scrape `og:title`, `og:description`, `og:image`,
  `og:site_name`, fall back to `<title>` + favicon. oEmbed for known
  providers (YouTube, Figma, Twitter, CodeSandbox).
- **Entity-aware autolinks**: Linear/GitHub recognize their own URL shapes
  and pull *live* state via their own API — issue status, PR checks, user
  presence. Higher signal than OG.

### Metadata sources, in order of reliability

1. oEmbed (when the domain supports it) — structured, versioned
2. Open Graph tags
3. Twitter Card tags (fallback overlap with OG)
4. `<link rel="icon">` / `/favicon.ico`, or Google's favicon proxy
5. First-party API for entity-aware previews

### Trigger patterns

| Product | Behavior |
|---|---|
| Notion | Paste URL → inline picker offers Dismiss / Mention / Embed / Bookmark |
| Linear | Smart auto-conversion based on URL shape, no picker |
| GitHub | Always plain link in source, hovercard on hover |
| Slack | Auto-unfurl, user can collapse/disable per-link |

---

## Proposed scope for v1

**Inline chip + hover card.** No bookmark card, no embed, no entity-aware
autolinks. Generic OG only.

### Trigger rule

In remark, a "bare URL" like `https://github.com/foo/bar` is autolinked: the
`<a>`'s text content equals its `href`. That's the heuristic.

| Markdown shape | Render |
|---|---|
| `[some text](https://...)` | inline `<a>`, plain underline + hover card |
| `https://...` (bare URL) | **chip** (favicon + title), hover card on chip |

Two-mode behavior matches Linear (paste a URL bare → mention; type explicit
text → keep your text). Lets writers opt out.

### Chip anatomy

```
+-----------------------------+
| O Pull request #142 - feat. |
+-----------------------------+
```

- favicon (14px), fallback to `Icons.Globe`
- truncated title (~48 chars)
- subtle background + border (use existing surface tokens, do not invent)

### Hover card anatomy

```
+------------------------------------------+
| O github.com                             |
|                                          |
|  feat(tui): rebuild launch screen as     |
|  create-first wizard                     |
|                                          |
|  Replaces the cramped grid with a four-  |
|  step wizard that surfaces group counts. |
|                                          |
|  github.com/uiid/bertrand/pull/142    -> |
+------------------------------------------+
```

- ~360px wide (Notion ~360, GitHub ~340)
- No `og:image` thumbnail in v1 — defer

---

## Implementation plan

### Part A — `LinkChip` primitive

**File**: `dashboard/src/components/markdown/link-chip.tsx`

**Why a new component, not a Badge variant**: Badge only has `size` and
`color` variants in the current `@uiid/design-system` (verified against
installed package). Loading/error visuals don't map to a Badge color slot,
and we need specific truncation rules.

**Public API**

```tsx
type LinkChipProps = {
  href: string
  // Optional preloaded metadata. If omitted, chip fetches via useLinkPreview().
  meta?: LinkPreview
  // Render fallback while metadata is loading (default: globe + hostname)
  fallback?: ReactNode
}
```

**Composition**

```tsx
<a href={href} target="_blank" rel="noopener noreferrer" className={chip}>
  <Group ay="center" gap={1.5} as="span">
    <Favicon url={meta?.favicon ?? null} fallback={<Icons.Globe size={14} />} />
    <Text size={0} truncate>
      {meta?.title ?? hostname(href)}
    </Text>
  </Group>
</a>
```

**`chip` styles**

- `display: inline-flex` so it sits in prose
- `padding: 1px 6px 1px 4px` (asymmetric — favicon hugs left)
- `border-radius: 6px`
- `background: var(--surface-subtle)` (use existing tokens, do not invent)
- `border: 1px solid var(--border-subtle)`
- `max-width: min(48ch, 100%)` (lets it shrink in narrow columns)
- `text-decoration: none`
- `vertical-align: baseline`

**`Favicon` sub-component**

```tsx
function Favicon({ url, fallback }: { url: string | null; fallback: ReactNode }) {
  const [errored, setErrored] = useState(false)
  if (!url || errored) return fallback
  return (
    <img
      src={url}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      onError={() => setErrored(true)}
      style={{ borderRadius: 2, flexShrink: 0 }}
    />
  )
}
```

**State table**

| Phase | Visual |
|---|---|
| Initial render (no fetch yet) | globe + hostname |
| Fetch in flight | same; no skeleton (would flicker) |
| Success | favicon + title (truncated) |
| Favicon 404 | globe + title (component-local fallback) |
| Metadata fetch failed | globe + hostname; no hover card opens |

**Hover-card wrapping** stays at the call site (in markdown's `a` renderer)
so `LinkChip` is reusable elsewhere without dragging the popover along:

```tsx
// in components.tsx, inside `a` renderer
const isBare = extractText(children) === href
if (isBare) {
  return (
    <Popover
      RootProps={{ openOnHover: true, delay: 250 }}
      trigger={<LinkChip href={href} meta={preview} />}
      icon={<Favicon url={preview?.favicon ?? null} fallback={...} />}
      title={preview?.title}
      description={preview?.description}
      footer={<Text size={-1} muted>{href}</Text>}
    />
  )
}
return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
```

### Part B — `/api/link-preview` route

**Endpoint**

```
GET /api/link-preview?url=<encoded>
-> 200 { url, finalUrl, title, description, siteName, favicon, fetchedAt }
-> 200 { url, error: "fetch_failed" | "blocked" | "timeout" }
-> 400 { error: "invalid_url" }
```

Always 200 for "we tried, here's what happened" — keeps TanStack Query
from spamming retries on dead links.

**Wiring** — add to existing Bun.serve regex router in `src/server/index.ts`:

```ts
[/^\/api\/link-preview$/, async (_p, url) => {
  const target = url.searchParams.get("url")
  if (!target || !isHttpUrl(target)) return { error: "invalid_url" }
  return await getLinkPreview(target)
}],
```

One change to `match()`: handler return type becomes
`unknown | Promise<unknown>` and `Response.json(result)` needs an `await`.

**Scraper**: `open-graph-scraper`. Wrap with:

- 5s timeout via `AbortSignal.timeout(5000)`
- 1MB max body cap
- User-agent identifying bertrand
- SSRF guard: refuse `localhost`, `10.*`, `172.16-31.*`, `192.168.*`,
  `169.254.*`, IPv6 link-local, etc.

**Cache** — SQLite via Drizzle (project already runs Drizzle, cache outlives
process restarts):

```ts
// src/db/schema.ts — new table
export const linkPreviews = sqliteTable("link_previews", {
  url: text("url").primaryKey(),
  finalUrl: text("final_url"),
  title: text("title"),
  description: text("description"),
  siteName: text("site_name"),
  favicon: text("favicon"),
  error: text("error"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
})
```

- TTL: 7 days for success, 1 hour for error rows (lets dead links recover).
- On read: fresh row → return; stale → return stale + kick background
  refresh (stale-while-revalidate).
- On miss: fetch synchronously, write, return.

**Client-side query** — drops into `dashboard/src/api/queries.ts`:

```ts
export const linkPreviewQuery = (url: string) =>
  queryOptions({
    queryKey: ["link-preview", url],
    queryFn: () => fetchJson<LinkPreview>(
      `/api/link-preview?url=${encodeURIComponent(url)}`
    ),
    staleTime: 1000 * 60 * 60,        // 1h on the client
    gcTime:    1000 * 60 * 60 * 24,   // 24h
    enabled: isHttpUrl(url),
  })
```

Then a `useLinkPreview(href)` hook (co-located in `link-chip.tsx` or
`use-link-preview.ts`) wraps `useQuery(linkPreviewQuery(href))`.

---

## Order of operations

Each step is independently mergeable and reviewable.

1. **Server slice**: Drizzle migration for `link_previews`, scraper module
   with SSRF guard + timeout, route handler, manual curl test.
2. **LinkChip slice (visual)**: build `LinkChip` + `Favicon` with hard-coded
   metadata, drop into `dashboard/src/routes/dev/markdown.tsx` for visual
   review. No fetching yet.
3. **Wire fetching**: add `linkPreviewQuery` + `useLinkPreview`, hook
   `LinkChip` to it.
4. **Hover card**: wrap chip in `@uiid/overlays` `Popover` inside markdown's
   `a` renderer. Verify `openOnHover` prop on this version of base-ui.

---

## Open questions

1. **Mobile**: should the chip be replaced by hover-card content (no hover),
   or do we add tap-to-expand?
2. **Internal/relative links** (`/sessions/foo`): probably skip — they're
   routing, not external context.
3. **Headings**: chips inside `<h1>`–`<h6>` look noisy. Force plain anchor
   in heading slots.
4. **SSRF guard**: bertrand binds localhost by default, but a curious user
   could `BERTRAND_HOST=0.0.0.0`. Cheap to add; recommend including.
5. **Cache strategy**: SQLite-via-Drizzle (recommended) vs. process-local
   LRU. Marginal cost difference; SQLite survives restarts.
6. **base-ui Popover hover API**: confirm `openOnHover` prop name and delay
   handling in the version pinned by `@uiid/overlays`.

---

## Survey references

- Notion: paste-URL picker, Mention/Bookmark/Embed tiers
- Linear: auto-mention on paste for known URL shapes
- GitHub: hovercards for `#123`, `@user`, repo refs, commit SHAs
- Slack/Discord: auto-unfurl with collapse control
- Vercel: minimal — plain links in docs, OG cards rendered server-side for share
