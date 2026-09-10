CREATE TABLE `prep_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`prep_item_id` text NOT NULL,
	`kind` text DEFAULT 'article' NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`source` text,
	`video_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`prep_item_id`) REFERENCES `prep_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prep_resource_item_url_unique` ON `prep_resources` (`prep_item_id`,`url`);--> statement-breakpoint
CREATE INDEX `prep_resource_item_idx` ON `prep_resources` (`prep_item_id`);