ALTER TABLE `prep_items` ADD `parent_id` text REFERENCES prep_items(id);--> statement-breakpoint
ALTER TABLE `prep_items` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prep_items` ADD `body` text;--> statement-breakpoint
CREATE INDEX `prep_parent_idx` ON `prep_items` (`parent_id`);