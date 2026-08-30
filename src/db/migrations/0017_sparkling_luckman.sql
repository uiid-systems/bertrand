CREATE TABLE `session_aliases` (
	`alias` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
