CREATE TABLE `halo_state_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`revision` text NOT NULL,
	`payload` text NOT NULL,
	`actor` text DEFAULT 'Rahbar' NOT NULL,
	`action` text DEFAULT 'Ma’lumot yangilandi' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
