CREATE TABLE `prep_reviews` (
	`prep_item_id` text PRIMARY KEY NOT NULL,
	`ease` real DEFAULT 2.5 NOT NULL,
	`interval_days` integer DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`last_rating` text,
	`due_at` integer NOT NULL,
	`last_reviewed_at` integer NOT NULL,
	FOREIGN KEY (`prep_item_id`) REFERENCES `prep_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prep_review_due_idx` ON `prep_reviews` (`due_at`);