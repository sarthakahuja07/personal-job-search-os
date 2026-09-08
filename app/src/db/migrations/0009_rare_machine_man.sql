CREATE TABLE `email_digests` (
	`id` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`body_text` text NOT NULL,
	`recipient` text,
	`notification_count` integer DEFAULT 0 NOT NULL,
	`sent_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
