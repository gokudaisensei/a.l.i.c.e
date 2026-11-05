CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_user_id` text,
	`connection_id` text,
	`entity_id` text,
	`summary` text NOT NULL,
	`tone` text DEFAULT 'info' NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_events_idx` ON `activity_events` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_events_entity_idx` ON `activity_events` (`household_id`,`entity_id`);--> statement-breakpoint
CREATE TABLE `activity_reads` (
	`user_id` text NOT NULL,
	`household_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `household_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
