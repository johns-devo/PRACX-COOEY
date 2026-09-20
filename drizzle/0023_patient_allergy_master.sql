CREATE TABLE `patient_allergies` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text,
	`allergy_type` text DEFAULT 'drug' NOT NULL,
	`substance` text NOT NULL,
	`reaction` text,
	`severity` text DEFAULT 'unknown' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`onset_date` text,
	`source` text,
	`notes` text,
	`recorded_by_user_id` text,
	`recorded_by_name` text NOT NULL,
	`reviewed_at` text,
	`reviewed_by_user_id` text,
	`reviewed_by_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_allergies_patient_status_idx` ON `patient_allergies` (`patient_id`,`status`);
