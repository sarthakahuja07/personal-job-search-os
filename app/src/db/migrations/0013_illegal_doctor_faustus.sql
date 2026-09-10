CREATE TABLE `reminder_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`kind` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_dismissal_unique` ON `reminder_dismissals` (`job_id`,`kind`);--> statement-breakpoint
ALTER TABLE `settings` ADD `reminder_thresholds` text DEFAULT '{"referralStatusDays":5,"applyAfterReferralDays":2,"decideOnSavedDays":4,"applicationSilentDays":14,"strongMatchDays":3}' NOT NULL;