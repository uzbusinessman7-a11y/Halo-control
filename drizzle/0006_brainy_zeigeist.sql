CREATE TABLE `halo_worker_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `halo_worker_users` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`name` text NOT NULL,
	`username` text NOT NULL,
	`pin_hash` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text DEFAULT '' NOT NULL,
	`last_login_at` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `halo_worker_branch_username` ON `halo_worker_users` (`branch_id`,`username`);