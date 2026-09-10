CREATE TABLE `linkedin_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`linkedin_job_id` text NOT NULL,
	`company_name` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`job_url` text NOT NULL,
	`feed` text NOT NULL,
	`posted_at` integer,
	`discovered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`dismissed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `linkedin_lead_job_unique` ON `linkedin_leads` (`linkedin_job_id`);--> statement-breakpoint
CREATE INDEX `linkedin_lead_discovered_idx` ON `linkedin_leads` (`discovered_at`);--> statement-breakpoint
CREATE INDEX `linkedin_lead_company_idx` ON `linkedin_leads` (`company_name`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `linkedin_job_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `linkedin_url` text;