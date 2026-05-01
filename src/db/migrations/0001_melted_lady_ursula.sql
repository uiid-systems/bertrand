PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'paused' NOT NULL,
	`summary` text,
	`pid` integer,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "group_id", "slug", "name", "status", "summary", "pid", "started_at", "ended_at", "created_at", "updated_at") SELECT "id", "group_id", "slug", "name", "status", "summary", "pid", "started_at", "ended_at", "created_at", "updated_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_group_slug` ON `sessions` (`group_id`,`slug`);--> statement-breakpoint
CREATE INDEX `sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_started` ON `sessions` (`started_at`);