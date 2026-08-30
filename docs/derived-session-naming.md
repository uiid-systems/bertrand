# ELKY-167 findings — dropping `category` does not degrade findability

Measured 2026-08-30 against every project DB on this machine, ahead of the
category-flattening migration (ELKY-171). This is the validation that gates
the migration; the collision rule decided here is enforced by the derivation
engine (ELKY-168), `bertrand rename` (ELKY-170), and the migration itself.

## Slug collisions if `category` were removed today

| Project DB | Sessions | Colliding slugs | Detail |
|---|---|---|---|
| bertrand | 52 | 1 | `fix-colors`: `diff/fix-colors` + `markdown/fix-colors` — both archived |
| design-system | 42 | 1 | `pkg-cleanup`: `button/pkg-cleanup` + `card/pkg-cleanup` — both archived |
| shuff-app | 7 | 0 | |
| default | 1 | 0 | |
| self-hosted | 1 | 0 | |

Two collisions across 103 sessions (~2%), and **all four colliding sessions are
archived** — archived sessions never appear in the sibling-context block, so the
block is untouched by flattening. The work machine's DBs (`balance`,
`tabs-backend`) were not measurable from here; the migration handles their
collisions by the same rule, whichever machine runs first.

## Collision rule (decided)

- **Automatic paths** (pause-time derivation, migration backfill): deterministic
  suffixing. The session with the earliest `started_at` keeps the bare slug;
  later ones get `-2`, `-3`, … A machine-generated name may be adjusted by the
  machine; identity is preserved via aliases.
- **Manual path** (`bertrand rename`): reject with an error naming the
  collider. A human asked for a specific name; silently giving them a different
  one is worse than failing.

## Back-compat lookup path

Every `category/slug` name the user has ever typed keeps resolving:

- A `session_aliases` table (alias → session_id) is populated by the migration
  with each session's pre-flatten `<category-path>/<slug>` name, and by
  `bertrand rename` with the session's previous canonical name.
- Name resolution tries the flat slug first, then the alias table. Legacy
  nested paths (pre-#129 rows) turn out not to matter: measured across every
  DB, zero sessions sit under a depth>0 category (the four nested categories
  in `default` are empty), so `<category.path>/<slug>` aliases cover the
  entire corpus.

## Sibling-context block

Renders flat `slug` lines post-flatten. Verified concern-free: the block
already leads with the slug as its distinguishing text (categories in the
current block are low-information — `github-projects` holds 16 of bertrand's 52
sessions), and the only ambiguous names in the corpus are archived and thus
excluded from the block.

## Verdict

Project + auto-slug remain as findable as `category/slug`: the namespace halves
but real ambiguity is ~2% and archived-only. Labels are not needed as a
precondition; they remain the escape hatch if flat naming ever fragments.

## Migration verification (ELKY-171, copy-run 2026-08-30)

Migration 0018 was run via `runMigrations()` against `.backup` copies of every
real project DB on this machine (never the originals), then re-run to prove
idempotency. Results:

| Project DB | Sessions | Events | Aliases written | Collisions suffixed | FK violations | Re-run |
|---|---|---|---|---|---|---|
| bertrand | 53 → 53 | 9087 → 9087 | 53 | `fix-colors` | 0 | no-op |
| design-system | 42 → 42 | 7773 → 7773 | 42 | `pkg-cleanup` | 0 | no-op |
| shuff-app | 7 → 7 | 1763 → 1763 | 7 | — | 0 | no-op |
| default | 1 → 1 | 84 → 84 | 1 | — | 0 | no-op |
| self-hosted | 1 → 1 | 185 → 185 | 1 | — | 0 | no-op |

Collision suffixing followed the started_at rule exactly:

- bertrand: `markdown/fix-colors` (03:19) kept `fix-colors`;
  `diff/fix-colors` (03:44) became `fix-colors-2`.
- design-system: `card/pkg-cleanup` (01:35) kept `pkg-cleanup`;
  `button/pkg-cleanup` (02:52) became `pkg-cleanup-2`.

Alias resolution spot-checked through `resolveSessionByName` against the
migrated bertrand copy: `markdown/fix-colors` → `fix-colors`,
`diff/fix-colors` → `fix-colors-2`, `dashboard/214-pty-exit-ux` →
`214-pty-exit-ux`; conversations/stats/label joins all intact and
`PRAGMA foreign_key_check` clean on every DB. The `categories` table and
`sessions.category_id` are gone; the `sessions_slug` UNIQUE index enforces
flat identity.

The same was proven end-to-end through the real CLI: with `HOME` pointed at a
scratch registry holding the migrated bertrand copy, `bertrand log
markdown/fix-colors` and `bertrand log diff/fix-colors` both resolve through
aliases to the correct (now-suffixed) sessions.

One mechanical note for future rebuilds: drizzle's migrator wraps every
pending migration in a single transaction, where `PRAGMA foreign_keys=OFF`
is a no-op — with enforcement on, `DROP TABLE sessions` cascade-deletes all
child rows. 0018 therefore closes the migrator's transaction (COMMIT), turns
enforcement off for real, runs atomically in its own transaction, and reopens
one (BEGIN) for the migrator's journal insert.
