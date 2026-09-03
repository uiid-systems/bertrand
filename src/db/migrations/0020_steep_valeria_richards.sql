ALTER TABLE `sessions` ADD `worktree_root` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `main_checkout` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `repo` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `group_key` text;--> statement-breakpoint
CREATE INDEX `sessions_group_key` ON `sessions` (`group_key`);--> statement-breakpoint
CREATE INDEX `sessions_repo` ON `sessions` (`repo`);