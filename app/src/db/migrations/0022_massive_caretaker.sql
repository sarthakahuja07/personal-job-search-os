-- prep_reviews is reshaped to key progress by (deck, page) instead of just page, so overlapping
-- decks (Everything is the union of every other deck) track independent progress. The table has
-- no rows in any environment yet, so this drops and recreates it rather than migrating data.
DROP TABLE `prep_reviews`;--> statement-breakpoint
CREATE TABLE `prep_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_id` text NOT NULL,
	`prep_item_id` text NOT NULL,
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
CREATE UNIQUE INDEX `prep_review_deck_item_unique` ON `prep_reviews` (`deck_id`,`prep_item_id`);--> statement-breakpoint
CREATE INDEX `prep_review_due_idx` ON `prep_reviews` (`due_at`);--> statement-breakpoint
CREATE INDEX `prep_review_deck_idx` ON `prep_reviews` (`deck_id`);
