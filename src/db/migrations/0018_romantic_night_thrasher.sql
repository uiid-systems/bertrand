-- Flatten categories into flat session slugs (ELKY-171).
--
-- The COMMIT/BEGIN sandwich below is load-bearing. Drizzle's migrator wraps
-- every pending migration in one BEGIN/COMMIT, and PRAGMA foreign_keys is a
-- no-op inside a transaction — so with enforcement on (db/client.ts turns it
-- on before migrating, and 0003's table rename depends on that), the
-- `DROP TABLE sessions` in the rebuild would cascade-delete every child row
-- (events, conversations, stats, labels, aliases). The leading COMMIT closes
-- the migrator's transaction so foreign_keys can actually turn OFF; the
-- migration then runs atomically in its own transaction (a failure anywhere —
-- including the UNIQUE index refusing a residual slug collision — rolls back
-- to the pre-0018 state via the migrator's ROLLBACK); the trailing BEGIN
-- reopens a transaction for the migrator's journal insert and final COMMIT.
COMMIT;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
BEGIN;--> statement-breakpoint

-- Back-compat: every session's pre-flatten "<category-path>/<slug>" name keeps
-- resolving via session_aliases. OR IGNORE so names already recorded by
-- `bertrand rename` are no-ops.
INSERT OR IGNORE INTO `session_aliases` ("alias", "session_id")
SELECT c."path" || '/' || s."slug", s."id"
FROM `sessions` s JOIN `categories` c ON s."category_id" = c."id";--> statement-breakpoint

-- Collision rule (ELKY-167): when flattening makes sessions share a slug, the
-- earliest started_at keeps the bare slug; later ones get -2, -3, … ordered by
-- started_at then id. MATERIALIZED so the ranking is snapshotted before the
-- UPDATE starts rewriting the rows it ranks. `name` follows the slug only when
-- it was the slug — a distinct display name is left alone.
WITH ranked AS MATERIALIZED (
  SELECT "id" AS rid, ROW_NUMBER() OVER (PARTITION BY "slug" ORDER BY "started_at", "id") AS rn
  FROM `sessions`
)
UPDATE `sessions` SET
  "name" = CASE WHEN "name" = "slug"
    THEN "slug" || '-' || (SELECT rn FROM ranked WHERE rid = `sessions`."id")
    ELSE "name" END,
  "slug" = "slug" || '-' || (SELECT rn FROM ranked WHERE rid = `sessions`."id")
WHERE "id" IN (SELECT rid FROM ranked WHERE rn > 1);--> statement-breakpoint

-- Fallback for the practically-unreachable case where a rank suffix lands on a
-- slug another session already holds: the earlier claimant keeps it, the rest
-- get an id-derived suffix (ids are unique, so this cannot re-collide with
-- itself). Anything still colliding after this aborts on the UNIQUE index
-- below and rolls the whole migration back.
WITH still_colliding AS MATERIALIZED (
  SELECT s1."id" AS cid FROM `sessions` s1
  WHERE EXISTS (
    SELECT 1 FROM `sessions` s2
    WHERE s2."slug" = s1."slug"
      AND (s2."started_at" < s1."started_at"
        OR (s2."started_at" = s1."started_at" AND s2."id" < s1."id"))
  )
)
UPDATE `sessions` SET
  "name" = CASE WHEN "name" = "slug"
    THEN "slug" || '-' || substr("id", 1, 6)
    ELSE "name" END,
  "slug" = "slug" || '-' || substr("id", 1, 6)
WHERE "id" IN (SELECT cid FROM still_colliding);--> statement-breakpoint

CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_source` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'paused' NOT NULL,
	`summary` text,
	`rating` integer,
	`pid` integer,
	`pid_started_at` integer,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`branch` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "slug", "name", "name_source", "status", "summary", "rating", "pid", "pid_started_at", "started_at", "ended_at", "branch", "created_at", "updated_at") SELECT "id", "slug", "name", "name_source", "status", "summary", "rating", "pid", "pid_started_at", "started_at", "ended_at", "branch", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_slug` ON `sessions` (`slug`);--> statement-breakpoint
CREATE INDEX `sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_started` ON `sessions` (`started_at`);--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint

COMMIT;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
BEGIN;
