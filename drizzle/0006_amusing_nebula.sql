PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_patient_coverages` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`priority` text DEFAULT 'unassigned' NOT NULL,
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
INSERT INTO `__new_patient_coverages`("id", "patient_id", "plan_id", "priority", "member_id", "group_number", "relationship", "subscriber_first_name", "subscriber_last_name", "subscriber_date_of_birth", "subscriber_sex", "subscriber_address_line_1", "subscriber_city", "subscriber_state", "subscriber_postal_code", "effective_date", "termination_date", "accept_assignment", "release_of_information", "assignment_of_benefits", "status", "created_at") SELECT "id", "patient_id", "plan_id", "priority", "member_id", "group_number", "relationship", "subscriber_first_name", "subscriber_last_name", "subscriber_date_of_birth", "subscriber_sex", "subscriber_address_line_1", "subscriber_city", "subscriber_state", "subscriber_postal_code", "effective_date", "termination_date", "accept_assignment", "release_of_information", "assignment_of_benefits", "status", "created_at" FROM `patient_coverages`;--> statement-breakpoint
DROP TABLE `patient_coverages`;--> statement-breakpoint
ALTER TABLE `__new_patient_coverages` RENAME TO `patient_coverages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `patient_coverages_patient_idx` ON `patient_coverages` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_coverage_member_unique` ON `patient_coverages` (`patient_id`,`plan_id`,`member_id`);--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `rendering_other_id_qualifier` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `rendering_other_id` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `epsdt_reason_code` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `family_planning_indicator` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `supplemental_qualifier` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `supplemental_information` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_claim_id_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_claim_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `condition_date_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `condition_date` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_date_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_date` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `referring_provider_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `referring_other_id_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `referring_other_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `service_facility_other_id_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `service_facility_other_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `billing_provider_other_id_qualifier` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `billing_provider_other_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `icd_indicator` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `bill_frequency_code` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `original_reference_number` text;