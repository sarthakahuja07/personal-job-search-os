CREATE TABLE `github_notes_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`branch` text,
	`fetched_at` integer NOT NULL
);
