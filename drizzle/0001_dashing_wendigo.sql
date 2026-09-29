CREATE TABLE `integration_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`permissions` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`last_used_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_api_keys_key_hash_unique` ON `integration_api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `integration_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text DEFAULT '' NOT NULL,
	`endpoint` text NOT NULL,
	`method` text NOT NULL,
	`status` integer NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_name` text DEFAULT '' NOT NULL,
	`store_id` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pos_product_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`external_code` text DEFAULT '' NOT NULL,
	`external_name` text DEFAULT '' NOT NULL,
	`normalized_name` text DEFAULT '' NOT NULL,
	`recipe_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
