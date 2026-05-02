CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`run_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`worker_id` text,
	`error` text,
	`dispatched_at` text,
	`completed_at` text,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`worker_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_run_id_unique` ON `runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `runs_created_at` ON `runs` ("created_at" DESC);--> statement-breakpoint
CREATE TABLE `workers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`worker_id` text NOT NULL,
	`hostname` text NOT NULL,
	`tailscale_name` text,
	`os` text,
	`arch` text,
	`version` text,
	`labels` text,
	`control_plane_url` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`registered_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workers_worker_id_unique` ON `workers` (`worker_id`);