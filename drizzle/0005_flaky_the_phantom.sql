CREATE TABLE `halo_worker_access` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`pin_hash` text NOT NULL,
	`session_hash` text DEFAULT '' NOT NULL,
	`session_expires_at` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
