CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`ended_at` text,
	`discarded` integer DEFAULT false NOT NULL,
	`last_question` text,
	`event_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conv_session` ON `conversations` (`session_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`conversation_id` text,
	`event` text NOT NULL,
	`summary` text,
	`meta` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ev_session` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `ev_session_event` ON `events` (`session_id`,`event`);--> statement-breakpoint
CREATE INDEX `ev_event_created` ON `events` (`event`,`created_at`);--> statement-breakpoint
CREATE INDEX `ev_conversation` ON `events` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`color` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_parent_slug` ON `groups` (`parent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `groups_path` ON `groups` (`path`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_unique` ON `labels` (`name`);--> statement-breakpoint
CREATE TABLE `session_labels` (
	`session_id` text NOT NULL,
	`label_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sl_pk` ON `session_labels` (`session_id`,`label_id`);--> statement-breakpoint
CREATE INDEX `sl_label` ON `session_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `session_stats` (
	`session_id` text PRIMARY KEY NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	`conversation_count` integer DEFAULT 0 NOT NULL,
	`interaction_count` integer DEFAULT 0 NOT NULL,
	`pr_count` integer DEFAULT 0 NOT NULL,
	`claude_work_s` integer DEFAULT 0 NOT NULL,
	`user_wait_s` integer DEFAULT 0 NOT NULL,
	`active_pct` integer DEFAULT 0 NOT NULL,
	`duration_s` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
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
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_group_slug` ON `sessions` (`group_id`,`slug`);--> statement-breakpoint
CREATE INDEX `sessions_status` ON `sessions` (`status`);--> statement-breakpoint
CREATE INDEX `sessions_started` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `worktree_associations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text,
	`active` integer DEFAULT true NOT NULL,
	`entered_at` text DEFAULT (datetime('now')) NOT NULL,
	`exited_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wt_session` ON `worktree_associations` (`session_id`);--> statement-breakpoint
CREATE INDEX `wt_active` ON `worktree_associations` (`active`);