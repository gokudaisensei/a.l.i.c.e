CREATE TABLE `backup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`destination` text NOT NULL,
	`destination_ref` text,
	`name` text NOT NULL,
	`size_bytes` integer,
	`sha256` text,
	`encrypted` integer DEFAULT false NOT NULL,
	`schema_version` integer,
	`status` text NOT NULL,
	`error` text,
	`trigger` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`verify_status` text DEFAULT 'none' NOT NULL,
	`verified_at` integer,
	`verify_note` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backup_records_idx` ON `backup_records` (`household_id`,`created_at`);