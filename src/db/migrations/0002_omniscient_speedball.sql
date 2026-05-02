ALTER TABLE `session_stats` ADD `lines_added` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_stats` ADD `lines_removed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_stats` ADD `files_touched` integer DEFAULT 0 NOT NULL;