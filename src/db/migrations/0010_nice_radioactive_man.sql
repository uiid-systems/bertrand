ALTER TABLE `session_stats` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_stats` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_stats` ADD `cache_creation_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_stats` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;