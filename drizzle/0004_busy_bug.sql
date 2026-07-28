CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`appointment_type` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`eligibility_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `appointments_org_start_idx` ON `appointments` (`organization_id`,`start_at`);--> statement-breakpoint
CREATE INDEX `appointments_provider_start_idx` ON `appointments` (`provider_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `claim_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`line_number` text NOT NULL,
	`procedure_code` text NOT NULL,
	`modifiers` text,
	`diagnosis_pointers` text DEFAULT 'A' NOT NULL,
	`units` text DEFAULT '1' NOT NULL,
	`charge_amount` text NOT NULL,
	`place_of_service` text DEFAULT '11' NOT NULL,
	`rendering_npi` text,
	`service_date_from` text NOT NULL,
	`service_date_to` text NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_line_unique` ON `claim_lines` (`claim_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`claim_number` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text,
	`coverage_id` text,
	`payer_id` text,
	`provider_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`referring_provider_id` text,
	`date_of_service` text NOT NULL,
	`transaction_date` text NOT NULL,
	`payment_date` text,
	`posting_date` text,
	`first_billed_date` text,
	`last_billed_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`scrubber_status` text DEFAULT 'not_run' NOT NULL,
	`scrubber_messages` text DEFAULT '[]' NOT NULL,
	`total_charge` text DEFAULT '0.00' NOT NULL,
	`total_paid` text DEFAULT '0.00' NOT NULL,
	`total_adjustment` text DEFAULT '0.00' NOT NULL,
	`patient_responsibility` text DEFAULT '0.00' NOT NULL,
	`submission_mode` text DEFAULT 'file' NOT NULL,
	`clearinghouse_trace` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_id`) REFERENCES `patient_coverages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referring_provider_id`) REFERENCES `referring_providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claims_org_number_unique` ON `claims` (`organization_id`,`claim_number`);--> statement-breakpoint
CREATE INDEX `claims_org_status_idx` ON `claims` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `claims_dos_idx` ON `claims` (`date_of_service`);--> statement-breakpoint
CREATE TABLE `eligibility_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`coverage_id` text NOT NULL,
	`date_of_service` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`copay_amount` text DEFAULT '0.00' NOT NULL,
	`deductible_remaining` text DEFAULT '0.00' NOT NULL,
	`coinsurance_percent` text DEFAULT '0' NOT NULL,
	`reference_number` text,
	`response_summary` text,
	`checked_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_id`) REFERENCES `patient_coverages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `eligibility_patient_dos_idx` ON `eligibility_checks` (`patient_id`,`date_of_service`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text,
	`patient_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`referring_provider_id` text,
	`date_of_service` text NOT NULL,
	`chief_complaint` text,
	`clinical_note` text,
	`diagnosis_codes` text DEFAULT '[]' NOT NULL,
	`procedure_codes` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`signed_at` text,
	`ready_to_bill_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referring_provider_id`) REFERENCES `referring_providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `encounters_patient_dos_idx` ON `encounters` (`patient_id`,`date_of_service`);--> statement-breakpoint
CREATE TABLE `fee_schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`fee_schedule_id` text NOT NULL,
	`procedure_code_id` text NOT NULL,
	`allowed_amount` text NOT NULL,
	`modifier` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`fee_schedule_id`) REFERENCES `fee_schedules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`procedure_code_id`) REFERENCES `procedure_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fee_item_unique` ON `fee_schedule_items` (`fee_schedule_id`,`procedure_code_id`,`modifier`);--> statement-breakpoint
CREATE TABLE `fee_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`payer_id` text,
	`name` text NOT NULL,
	`effective_date` text NOT NULL,
	`termination_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fee_schedules_org_idx` ON `fee_schedules` (`organization_id`);--> statement-breakpoint
CREATE TABLE `insurance_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`payer_id` text NOT NULL,
	`name` text NOT NULL,
	`plan_type` text DEFAULT 'PPO' NOT NULL,
	`default_group_number` text,
	`timely_filing_days` text DEFAULT '90' NOT NULL,
	`requires_referral` text DEFAULT 'no' NOT NULL,
	`requires_authorization` text DEFAULT 'no' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `insurance_plans_payer_idx` ON `insurance_plans` (`payer_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`integration_type` text NOT NULL,
	`vendor_name` text NOT NULL,
	`mode` text DEFAULT 'file' NOT NULL,
	`status` text DEFAULT 'needs_credentials' NOT NULL,
	`endpoint` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integration_org_type_unique` ON `integrations` (`organization_id`,`integration_type`);--> statement-breakpoint
CREATE TABLE `ledger_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`claim_id` text,
	`transaction_type` text NOT NULL,
	`source` text NOT NULL,
	`amount` text NOT NULL,
	`description` text NOT NULL,
	`reference_number` text,
	`date_of_service` text,
	`transaction_date` text NOT NULL,
	`payment_date` text,
	`posting_date` text NOT NULL,
	`first_billed_date` text,
	`last_billed_date` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_org_posting_idx` ON `ledger_transactions` (`organization_id`,`posting_date`);--> statement-breakpoint
CREATE INDEX `ledger_claim_idx` ON `ledger_transactions` (`claim_id`);--> statement-breakpoint
CREATE TABLE `patient_coverages` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`priority` text DEFAULT 'primary' NOT NULL,
	`member_id` text NOT NULL,
	`group_number` text,
	`relationship` text DEFAULT 'self' NOT NULL,
	`subscriber_first_name` text NOT NULL,
	`subscriber_last_name` text NOT NULL,
	`subscriber_date_of_birth` text,
	`subscriber_sex` text,
	`subscriber_address_line_1` text,
	`subscriber_city` text,
	`subscriber_state` text,
	`subscriber_postal_code` text,
	`effective_date` text,
	`termination_date` text,
	`accept_assignment` text DEFAULT 'yes' NOT NULL,
	`release_of_information` text DEFAULT 'yes' NOT NULL,
	`assignment_of_benefits` text DEFAULT 'yes' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `insurance_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_coverages_patient_idx` ON `patient_coverages` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_coverage_member_unique` ON `patient_coverages` (`patient_id`,`plan_id`,`member_id`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_number` text NOT NULL,
	`first_name` text NOT NULL,
	`middle_name` text,
	`last_name` text NOT NULL,
	`suffix` text,
	`date_of_birth` text NOT NULL,
	`sex` text DEFAULT 'unknown' NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postal_code` text NOT NULL,
	`phone` text,
	`email` text,
	`marital_status` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_org_account_unique` ON `patients` (`organization_id`,`account_number`);--> statement-breakpoint
CREATE INDEX `patients_org_name_idx` ON `patients` (`organization_id`,`last_name`,`first_name`);--> statement-breakpoint
CREATE TABLE `payers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`payer_id` text NOT NULL,
	`eligibility_payer_id` text,
	`claim_filing_indicator` text DEFAULT 'CI' NOT NULL,
	`payer_type` text DEFAULT 'Commercial' NOT NULL,
	`clearinghouse_route` text,
	`phone` text,
	`fax` text,
	`address_line_1` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payers_org_payer_id_unique` ON `payers` (`organization_id`,`payer_id`);--> statement-breakpoint
CREATE INDEX `payers_org_status_idx` ON `payers` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`remittance_id` text,
	`payment_type` text NOT NULL,
	`payer_name` text,
	`amount` text DEFAULT '0.00' NOT NULL,
	`adjustment_amount` text DEFAULT '0.00' NOT NULL,
	`adjustment_reason` text,
	`reference_number` text,
	`transaction_date` text NOT NULL,
	`payment_date` text NOT NULL,
	`posting_date` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`remittance_id`) REFERENCES `remittances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_claim_idx` ON `payments` (`claim_id`);--> statement-breakpoint
CREATE TABLE `procedure_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`code_set` text DEFAULT 'CPT' NOT NULL,
	`default_charge` text DEFAULT '0.00' NOT NULL,
	`default_place_of_service` text DEFAULT '11' NOT NULL,
	`requires_authorization` text DEFAULT 'no' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procedure_codes_code_unique` ON `procedure_codes` (`code`);--> statement-breakpoint
CREATE TABLE `reconsiderations` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`method` text DEFAULT 'fax' NOT NULL,
	`destination` text,
	`reason` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`attachment_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reconsiderations_claim_idx` ON `reconsiderations` (`claim_id`);--> statement-breakpoint
CREATE TABLE `remittances` (
	`id` text PRIMARY KEY NOT NULL,
	`payer_id` text,
	`trace_number` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount` text NOT NULL,
	`source` text DEFAULT '835_file' NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`raw_835` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`posted_at` text,
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `remittances_trace_unique` ON `remittances` (`trace_number`);