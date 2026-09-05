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
	`location_priority` integer,
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
	`match_rules` text DEFAULT '{"title":{"include":[{"pattern":"software\\s+(development\\s+)?engineer\\s*(-|–)?\\s*(ii|2)\\b","score":100,"label":"Software Engineer II"},{"pattern":"\\bsde\\s*(-|–)?\\s*(ii|2)\\b","score":100,"label":"SDE 2"},{"pattern":"\\bswe\\s*(-|–)?\\s*(ii|2)\\b","score":100,"label":"SWE 2"},{"pattern":"\\bengineer\\s*(-|–)?\\s*(ii|2)\\b","score":90,"label":"Engineer II"},{"pattern":"\\bdeveloper\\s*(-|–)?\\s*(ii|2)\\b","score":90,"label":"Developer II"},{"pattern":"\\bl4\\b","score":90,"label":"L4 (Google SDE-2 equivalent)"},{"pattern":"\\be4\\b","score":85,"label":"E4 (Meta SDE-2 equivalent)"},{"pattern":"\\blevel\\s*4\\b","score":85,"label":"Level 4"},{"pattern":"member\\s+of\\s+technical\\s+staff\\s*(-|–)?\\s*(ii|2)\\b","score":90,"label":"MTS 2"},{"pattern":"\\bmts\\s*(-|–)?\\s*(ii|2)\\b","score":90,"label":"MTS 2"},{"pattern":"\\bsoftware\\s+engineer\\b","score":65,"label":"Software Engineer (unlevelled)"},{"pattern":"\\bbackend\\s+(software\\s+)?(engineer|developer)\\b","score":65,"label":"Backend Engineer"},{"pattern":"\\bback[-\\s]?end\\s+(engineer|developer)\\b","score":65,"label":"Backend Engineer"},{"pattern":"\\bfull[-\\s]?stack\\s+(engineer|developer)\\b","score":60,"label":"Full Stack Engineer"},{"pattern":"\\b(platform|infrastructure|distributed\\s+systems)\\s+engineer\\b","score":60,"label":"Platform / Infra Engineer"},{"pattern":"\\bmember\\s+of\\s+technical\\s+staff\\b","score":60,"label":"Member of Technical Staff"},{"pattern":"\\bsoftware\\s+developer\\b","score":60,"label":"Software Developer"}],"exclude":["\\bsenior\\b","\\bsr\\.?\\b","(?<!technical\\s)\\bstaff\\b","\\bprincipal\\b","\\blead\\b","\\barchitect\\b","\\bdistinguished\\b","\\bfellow\\b","\\bdirector\\b","\\bmanager\\b","\\bhead\\s+of\\b","\\bvp\\b","\\bvice\\s+president\\b","\\b(iii|iv|v|vi)\\b","\\bengineer\\s*(-|–)?\\s*[3-9]\\b","\\bl[5-9]\\b","\\be[5-9]\\b","\\blevel\\s*[5-9]\\b","\\bintern\\b","\\binternship\\b","\\bapprentice\\b","\\btrainee\\b","\\bnew\\s+grad\\b","\\bgraduate\\b","\\bjunior\\b","\\bjr\\.?\\b","\\bentry[-\\s]?level\\b","\\bsde\\s*(-|–)?\\s*(i|1)\\b","\\bswe\\s*(-|–)?\\s*(i|1)\\b","\\bengineer\\s*(-|–)?\\s*(i|1)\\b","\\bl3\\b","\\bsdet\\b","\\btest\\s+engineer\\b","\\bqa\\b","\\bsupport\\s+engineer\\b","\\bengineer\\s+in\\s+test\\b","\\bquality\\s+assurance\\b","\\bsales\\b","\\brecruiter\\b","\\bmarketing\\b","\\bdesigner\\b","\\bproduct\\s+manager\\b","\\bprogram\\s+manager\\b","\\bproject\\s+manager\\b","\\btechnical\\s+writer\\b","\\bsolutions?\\s+engineer\\b","\\bcustomer\\b","\\bfield\\s+engineer\\b","\\bmechanical\\b","\\bhardware\\b","\\bfirmware\\b","\\basic\\b","\\bpcb\\b","\\brtl\\b","\\bdft\\b","\\bsilicon\\b","\\banalog\\b","\\bphysical\\s+design\\b","\\bsoc\\s+design\\b","\\bdesign\\s+engineer\\b","\\blayout\\b","\\bverification\\s+engineer\\b","\\bvlsi\\b","\\bsignal\\s+integrity\\b","\\bthermal\\b","\\bmechanical\\b"]},"experience":{"idealMaxYears":4,"hardRejectYears":7,"penaltyPerYear":10,"unknownPasses":true},"location":{"allow":[{"name":"Bangalore","priority":1,"score":40,"aliases":["bangalore","bengaluru","blr"]},{"name":"Gurgaon","priority":2,"score":30,"aliases":["gurgaon","gurugram","delhi ncr","ncr","new delhi","noida"]},{"name":"Remote","priority":3,"score":20,"aliases":["remote","work from home","wfh","anywhere","distributed"]},{"name":"Hyderabad","priority":4,"score":10,"aliases":["hyderabad","hyd","telangana"]}],"reject":["\\bus\\b","\\bu\\.s\\.","united states","\\busa\\b","canada","\\buk\\b","united kingdom","ireland","germany","france","italy","spain","portugal","netherlands","belgium","austria","switzerland","sweden","norway","denmark","finland","poland","czech","hungary","romania","ukraine","russia","turkey","israel","china","taiwan","japan","korea","singapore","malaysia","indonesia","thailand","vietnam","philippines","australia","new zealand","brazil","mexico","argentina","chile","colombia","peru","egypt","south africa","armenia","hong kong","\\buae\\b","dubai","saudi","\\bemea\\b","\\blatam\\b","\\bapac\\b"],"unknownPasses":true},"threshold":60}' NOT NULL,
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
