CREATE TABLE `patient_legal_responsibilities` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`responsibility_type` text NOT NULL,
	`balance_role` text DEFAULT 'final_balance' NOT NULL,
	`organization_name` text,
	`attorney_name` text,
	`case_number` text,
	`lop_number` text,
	`signed_date` text,
	`received_date` text,
	`effective_date` text,
	`termination_date` text,
	`authorized_amount` text,
	`settlement_status` text DEFAULT 'open' NOT NULL,
	`lien_status` text DEFAULT 'not_recorded' NOT NULL,
	`phone` text,
	`email` text,
	`fax` text,
	`address_line_1` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_legal_responsibility_patient_idx` ON `patient_legal_responsibilities` (`patient_id`,`status`);--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `coverage_type` text DEFAULT 'health' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `property_casualty_claim_number` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `accident_date` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `accident_state` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `adjuster_name` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `adjuster_phone` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `adjuster_email` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `adjuster_fax` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `claim_address_line_1` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `claim_city` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `claim_state` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `claim_postal_code` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `coverage_limit` text;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `amount_used` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_coverages` ADD `authorization_number` text;