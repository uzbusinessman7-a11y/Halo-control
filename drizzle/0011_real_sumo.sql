CREATE TABLE `halo_assistant_config` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`bot_token` text NOT NULL,
	`bot_name` text NOT NULL,
	`secret` text NOT NULL,
	`generation` text NOT NULL,
	`pair_hash` text DEFAULT '' NOT NULL,
	`pair_expires` integer DEFAULT 0 NOT NULL,
	`candidate_id` text DEFAULT '' NOT NULL,
	`candidate_name` text DEFAULT '' NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `halo_assistant_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source_key` text NOT NULL,
	`branch_id` text NOT NULL,
	`actor` text NOT NULL,
	`generation` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`payload` text DEFAULT '' NOT NULL,
	`response` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `halo_assistant_jobs_source_key_unique` ON `halo_assistant_jobs` (`source_key`);