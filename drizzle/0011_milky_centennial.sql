CREATE TABLE `eligibility_update_history` (
	`id` text PRIMARY KEY NOT NULL,
	`eligibility_check_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`coverage_id` text NOT NULL,
	`address_choice` text NOT NULL,
	`before_snapshot` text NOT NULL,
	`response_snapshot` text NOT NULL,
	`applied_snapshot` text NOT NULL,
	`reason` text NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`eligibility_check_id`) REFERENCES `eligibility_checks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_id`) REFERENCES `patient_coverages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `eligibility_update_patient_idx` ON `eligibility_update_history` (`patient_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `eligibility_checks` ADD `response_details` text;