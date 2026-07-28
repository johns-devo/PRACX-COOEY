CREATE TABLE `patient_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`coverage_id` text,
	`claim_id` text,
	`category` text NOT NULL,
	`document_side` text DEFAULT 'none' NOT NULL,
	`title` text NOT NULL,
	`original_file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`file_size` text NOT NULL,
	`service_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_id`) REFERENCES `patient_coverages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_documents_patient_idx` ON `patient_documents` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `patient_documents_coverage_idx` ON `patient_documents` (`coverage_id`);