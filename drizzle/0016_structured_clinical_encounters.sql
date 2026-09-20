ALTER TABLE `encounters` ADD `history_of_present_illness` text;
ALTER TABLE `encounters` ADD `review_of_systems` text;
ALTER TABLE `encounters` ADD `physical_exam` text;
ALTER TABLE `encounters` ADD `assessment` text;
ALTER TABLE `encounters` ADD `treatment_plan` text;
ALTER TABLE `encounters` ADD `follow_up_instructions` text;
ALTER TABLE `encounters` ADD `vitals` text DEFAULT '{}' NOT NULL;
ALTER TABLE `encounters` ADD `allergies_reviewed` text DEFAULT 'no' NOT NULL;
ALTER TABLE `encounters` ADD `medications_reviewed` text DEFAULT 'no' NOT NULL;
ALTER TABLE `encounters` ADD `signed_by_user_id` text REFERENCES `users`(`id`);
ALTER TABLE `encounters` ADD `signed_by_name` text;
ALTER TABLE `encounters` ADD `last_saved_at` text;

CREATE TABLE `encounter_events` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`action` text NOT NULL,
	`status_from` text,
	`status_to` text NOT NULL,
	`changed_by_user_id` text,
	`changed_by_name` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `encounter_events_encounter_time_idx` ON `encounter_events` (`encounter_id`,`occurred_at`);
