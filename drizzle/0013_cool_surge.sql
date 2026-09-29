CREATE TABLE `telegram_daily_deliveries` (
	`branch_id` text NOT NULL,
	`report_date` text NOT NULL,
	`status` text NOT NULL,
	`claim_id` text NOT NULL,
	`claimed_at` text NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_daily_branch_date` ON `telegram_daily_deliveries` (`branch_id`,`report_date`);