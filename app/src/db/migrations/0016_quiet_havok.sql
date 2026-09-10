DROP INDEX `prep_kind_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `prep_kind_parent_slug_unique` ON `prep_items` (`kind`, coalesce(`parent_id`, ''), `slug`);
