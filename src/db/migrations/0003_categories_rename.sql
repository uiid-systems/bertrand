ALTER TABLE `groups` RENAME TO `categories`;--> statement-breakpoint
ALTER TABLE `sessions` RENAME COLUMN `group_id` TO `category_id`;--> statement-breakpoint
DROP INDEX `groups_parent_slug`;--> statement-breakpoint
DROP INDEX `groups_path`;--> statement-breakpoint
DROP INDEX `sessions_group_slug`;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_parent_slug` ON `categories` (`parent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_path` ON `categories` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_category_slug` ON `sessions` (`category_id`,`slug`);
