CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`company_id` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`notes` text,
	`requested_at` integer,
	`referred_at` integer,
	`applied_at` integer,
	`interview_started_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_job_unique` ON `applications` (`job_id`);--> statement-breakpoint
CREATE INDEX `applications_status_idx` ON `applications` (`status`);--> statement-breakpoint
CREATE INDEX `applications_requested_idx` ON `applications` (`requested_at`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website_url` text,
	`careers_url` text,
	`source_type` text NOT NULL,
	`source_tier` integer DEFAULT 6 NOT NULL,
	`source_config` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`allow_zero_results` integer DEFAULT false NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_content_hash` text,
	`last_crawled_at` integer,
	`last_success_at` integer,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_name_unique` ON `companies` (`name`);--> statement-breakpoint
CREATE INDEX `companies_active_idx` ON `companies` (`active`);--> statement-breakpoint
CREATE INDEX `companies_health_idx` ON `companies` (`health_status`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contacts_company_idx` ON `contacts` (`company_id`);--> statement-breakpoint
CREATE TABLE `crawl_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`company_id` text,
	`status` text NOT NULL,
	`tier` integer,
	`jobs_found` integer DEFAULT 0 NOT NULL,
	`new_jobs` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`skip_reason` text,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crawl_runs_company_idx` ON `crawl_runs` (`company_id`);--> statement-breakpoint
CREATE INDEX `crawl_runs_run_idx` ON `crawl_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `crawl_runs_started_idx` ON `crawl_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`external_job_id` text NOT NULL,
	`title` text NOT NULL,
	`location` text,
	`department` text,
	`description` text,
	`job_url` text NOT NULL,
	`normalized_job_url` text NOT NULL,
	`posted_at` integer,
	`discovered_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`source` text NOT NULL,
	`employment_type` text,
	`raw_metadata` text,
	`is_relevant` integer DEFAULT false NOT NULL,
	`match_score` integer DEFAULT 0 NOT NULL,
	`match_reason` text,
	`missing_run_count` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_external_unique` ON `jobs` (`company_id`,`external_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_company_url_unique` ON `jobs` (`company_id`,`normalized_job_url`);--> statement-breakpoint
CREATE INDEX `jobs_relevant_idx` ON `jobs` (`is_relevant`);--> statement-breakpoint
CREATE INDEX `jobs_discovered_idx` ON `jobs` (`discovered_at`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company_id`);--> statement-breakpoint
CREATE INDEX `jobs_closed_idx` ON `jobs` (`closed_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`dedup_key` text NOT NULL,
	`notification_type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`channel` text DEFAULT 'email' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedup_unique` ON `notifications` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`resume_url` text,
	`notify_email` text,
	`include_keywords` text DEFAULT '[]' NOT NULL,
	`exclude_keywords` text DEFAULT '[]' NOT NULL,
	`preferred_locations` text DEFAULT '[]' NOT NULL,
	`follow_up_days` integer DEFAULT 5 NOT NULL,
	`close_after_missing_runs` integer DEFAULT 3 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
