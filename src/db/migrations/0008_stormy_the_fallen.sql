CREATE TABLE `ingest_cursors` (
	`transcript_path` text PRIMARY KEY NOT NULL,
	`offset` integer DEFAULT 0 NOT NULL,
	`last_uuid` text,
	`pending_thinking_blocks` integer DEFAULT 0 NOT NULL,
	`pending_thinking_bytes` integer DEFAULT 0 NOT NULL,
	`pending_uuid` text,
	`pending_timestamp` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
