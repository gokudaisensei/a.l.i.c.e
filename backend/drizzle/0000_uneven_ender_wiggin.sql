CREATE TABLE `device_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`service` text NOT NULL,
	`payload` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `device_commands_household_idx` ON `device_commands` (`household_id`);--> statement-breakpoint
CREATE INDEX `device_commands_state_idx` ON `device_commands` (`state`);