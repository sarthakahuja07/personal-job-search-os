CREATE TABLE `prep_code_files` (
	`id` text PRIMARY KEY NOT NULL,
	`prep_item_id` text NOT NULL,
	`path` text NOT NULL,
	`language` text,
	`content` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`prep_item_id`) REFERENCES `prep_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prep_code_file_item_path_unique` ON `prep_code_files` (`prep_item_id`,`path`);--> statement-breakpoint
CREATE INDEX `prep_code_file_item_idx` ON `prep_code_files` (`prep_item_id`);