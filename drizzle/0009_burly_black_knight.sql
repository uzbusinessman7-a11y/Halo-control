CREATE TABLE `mezana_telegram_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`sent_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mezana_telegram_branch_entry` ON `mezana_telegram_deliveries` (`branch_id`,`entry_id`);