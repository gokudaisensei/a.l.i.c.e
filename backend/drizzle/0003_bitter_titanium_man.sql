CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`connection_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`thing_ref` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL,
	`cleared_at` integer,
	`acked_by` text,
	`acked_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alerts_household_idx` ON `alerts` (`household_id`,`cleared_at`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`household_id` text NOT NULL,
	`triggered_at` integer NOT NULL,
	`source` text,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `automation_runs_idx` ON `automation_runs` (`automation_id`,`triggered_at`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`sync_status` text DEFAULT 'not_synced' NOT NULL,
	`sync_error` text,
	`synced_at` integer,
	`ha_entity_id` text,
	`compiled_hash` text,
	`last_triggered_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automations_household_idx` ON `automations` (`household_id`);--> statement-breakpoint
CREATE TABLE `config_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`operation` text NOT NULL,
	`payload` text NOT NULL,
	`dedupe_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer NOT NULL,
	`result` text,
	`error` text,
	`requested_by` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`applied_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `config_jobs_status_idx` ON `config_jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `config_jobs_dedupe_idx` ON `config_jobs` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `config_worker_heartbeat` (
	`name` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	`info` text
);
--> statement-breakpoint
CREATE TABLE `insight_dismissals` (
	`household_id` text NOT NULL,
	`key` text NOT NULL,
	`until` integer NOT NULL,
	PRIMARY KEY(`household_id`, `key`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`data` text,
	`urgent` integer DEFAULT false NOT NULL,
	`push_status` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `person_links` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`person_entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_links_person_unique` ON `person_links` (`household_id`,`connection_id`,`person_entity_id`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`token` text NOT NULL,
	`keys` text,
	`label` text,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_unique` ON `push_subscriptions` (`user_id`,`platform`,`token`);--> statement-breakpoint
CREATE TABLE `routine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`routine_id` text NOT NULL,
	`routine_name` text NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`steps` text NOT NULL,
	`on_failure` text DEFAULT 'continue' NOT NULL,
	`next_step` integer DEFAULT 0 NOT NULL,
	`resume_at` integer,
	`step_up_until` integer DEFAULT 0 NOT NULL,
	`cancel_requested` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `routine_runs_household_idx` ON `routine_runs` (`household_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `routine_runs_state_idx` ON `routine_runs` (`state`);--> statement-breakpoint
ALTER TABLE `entity_settings` ADD `voice_sync_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `entity_settings` ADD `voice_sync_error` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `sync_status` text DEFAULT 'not_synced' NOT NULL;--> statement-breakpoint
ALTER TABLE `routines` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `routines` ADD `synced_at` integer;--> statement-breakpoint
ALTER TABLE `routines` ADD `ha_entity_id` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `sync_status` text DEFAULT 'not_synced' NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `sync_error` text;--> statement-breakpoint
ALTER TABLE `scenes` ADD `synced_at` integer;--> statement-breakpoint
ALTER TABLE `scenes` ADD `ha_entity_id` text;