ALTER TABLE `claims` ADD `remaining_balance` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_entries` ADD `reconciliation_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `remittances` ADD `processed_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `remittances` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `remittances` ADD `file_path` text;--> statement-breakpoint
ALTER TABLE `remittances` ADD `payment_entry_id` text;--> statement-breakpoint
ALTER TABLE `remittances` ADD `unmatched_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `remittances` ADD `parse_warnings_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `remittances` ADD `error_message` text;--> statement-breakpoint
ALTER TABLE `remittances` ADD `processed_at` text;--> statement-breakpoint
CREATE TABLE `reconciliation_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`previous_total_effective` text DEFAULT '0.00' NOT NULL,
	`previous_total_posted` text DEFAULT '0.00' NOT NULL,
	`previous_difference` text DEFAULT '0.00' NOT NULL,
	`new_total_effective` text DEFAULT '0.00' NOT NULL,
	`new_total_posted` text DEFAULT '0.00' NOT NULL,
	`new_difference` text DEFAULT '0.00' NOT NULL,
	`corrected_by_user_id` text,
	`corrected_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment_entries`(`id`)
);--> statement-breakpoint
CREATE INDEX `reconciliation_logs_payment_idx` ON `reconciliation_logs` (`payment_id`,`created_at`);
