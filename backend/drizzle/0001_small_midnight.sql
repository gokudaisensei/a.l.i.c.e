CREATE TABLE `entity_overrides` (
	`household_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text,
	`display_name` text,
	`attach_to` text,
	`hidden` integer,
	`on_means` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `entity_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ha_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`operational_token_enc` text NOT NULL,
	`admin_token_enc` text,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_connected_at` integer,
	`last_error` text,
	`ha_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ha_connections_household_idx` ON `ha_connections` (`household_id`);--> statement-breakpoint
CREATE TABLE `thing_links` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`kind` text NOT NULL,
	`refs` text,
	`entity_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thing_links_connection_idx` ON `thing_links` (`connection_id`);--> statement-breakpoint
CREATE TABLE `thing_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`ref` text NOT NULL,
	`display_name` text,
	`hidden` integer,
	`area_id` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thing_overrides_unique` ON `thing_overrides` (`connection_id`,`ref`);