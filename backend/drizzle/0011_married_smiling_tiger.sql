ALTER TABLE `commands` ADD `previous_state` text;--> statement-breakpoint
ALTER TABLE `commands` ADD `undo_of` text;--> statement-breakpoint
ALTER TABLE `commands` ADD `undone_by` text;