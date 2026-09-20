ALTER TABLE `claims` ADD `diagnosis_codes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `claim_data_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE TABLE `claim_correction_history` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`action` text DEFAULT 'save' NOT NULL,
	`change_scope` text DEFAULT 'claim_only' NOT NULL,
	`reason` text,
	`before_snapshot` text NOT NULL,
	`after_snapshot` text NOT NULL,
	`changed_by_user_id` text NOT NULL,
	`changed_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `claim_correction_history_claim_idx` ON `claim_correction_history` (`claim_id`,`created_at`);
