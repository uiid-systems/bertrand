ALTER TABLE `conversations` ADD `model` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `cache_creation_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;