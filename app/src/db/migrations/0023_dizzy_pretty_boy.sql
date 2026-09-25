CREATE TABLE `prep_custom_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`mode` text NOT NULL,
	`company_slug` text,
	`discipline` text,
	`difficulty` text,
	`question_ids` text,
	`created_at` integer NOT NULL
);
