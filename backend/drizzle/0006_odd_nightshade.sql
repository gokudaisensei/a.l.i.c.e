CREATE TABLE `update_records` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`from_version` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`reason` text,
	`requested_by` text,
	`scheduled_for` integer,
	`backup_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `update_records_idx` ON `update_records` (`household_id`,`created_at`);