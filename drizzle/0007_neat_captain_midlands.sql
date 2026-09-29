ALTER TABLE `integration_api_keys` ADD `branch_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `integration_logs` ADD `branch_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `pos_product_mappings` ADD `branch_id` text DEFAULT 'main' NOT NULL;