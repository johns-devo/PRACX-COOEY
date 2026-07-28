ALTER TABLE `claim_lines` ADD `emergency_indicator` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `epsdt_indicator` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `ndc_code` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `ndc_unit_qualifier` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `ndc_quantity` text;--> statement-breakpoint
ALTER TABLE `claim_lines` ADD `ndc_unit_price` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `insurance_type_code` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_plan_indicator` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `employment_related` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `auto_accident_related` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `auto_accident_state` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `other_accident_related` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `claim_condition_codes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `unable_to_work_from` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `unable_to_work_to` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `hospitalization_from` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `hospitalization_to` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `outside_lab_indicator` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `outside_lab_charges` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `prior_authorization_number` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `federal_tax_id_type` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `federal_tax_id_number` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `patient_signature_on_file` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `patient_signature_date` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `insured_signature_on_file` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `provider_signature_on_file` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `provider_signature_date` text;