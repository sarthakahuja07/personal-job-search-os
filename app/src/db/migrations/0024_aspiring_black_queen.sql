ALTER TABLE `contacts` ADD `role` text DEFAULT 'referrer' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `last_called_at` integer;--> statement-breakpoint
-- Until now HR contacts were marked only by name ("Meesho HR", "Asha (HR)"). GLOB, not LIKE:
-- it is case-sensitive, and LIKE '%hr%' would also catch "Shruti".
UPDATE `contacts` SET `role` = 'hr' WHERE `name` GLOB '* HR' OR `name` GLOB '*(HR)*';--> statement-breakpoint
-- The role now says it, so the name no longer has to: "Hi Asha (HR)" is not a greeting.
UPDATE `contacts` SET `name` = trim(replace(`name`, '(HR)', '')) WHERE `name` GLOB '*?(HR)*';
