CREATE TABLE `billing_responsibility_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`profile_name` text NOT NULL,
	`billing_context` text DEFAULT 'routine' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`verification_status` text DEFAULT 'reported' NOT NULL,
	`guarantor_type` text DEFAULT 'patient' NOT NULL,
	`guarantor_name` text,
	`patient_billing_hold` text DEFAULT 'no' NOT NULL,
	`reason` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `responsibility_profile_patient_dos_idx` ON `billing_responsibility_profiles` (`patient_id`,`billing_context`,`effective_from`);--> statement-breakpoint
CREATE TABLE `claim_responsibility_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`profile_id` text,
	`billing_context` text NOT NULL,
	`profile_snapshot` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_id`) REFERENCES `billing_responsibility_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_responsibility_snapshot_unique` ON `claim_responsibility_snapshots` (`claim_id`);--> statement-breakpoint
CREATE TABLE `responsibility_profile_history` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`action` text NOT NULL,
	`snapshot` text NOT NULL,
	`reason` text,
	`changed_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `billing_responsibility_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `responsibility_history_profile_idx` ON `responsibility_profile_history` (`profile_id`);--> statement-breakpoint
CREATE TABLE `responsibility_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`sequence` text NOT NULL,
	`role` text NOT NULL,
	`source_type` text NOT NULL,
	`coverage_id` text,
	`source_name` text NOT NULL,
	`activation_condition` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `billing_responsibility_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`coverage_id`) REFERENCES `patient_coverages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `responsibility_source_sequence_unique` ON `responsibility_sources` (`profile_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `responsibility_source_profile_idx` ON `responsibility_sources` (`profile_id`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `billing_context` text DEFAULT 'routine' NOT NULL;--> statement-breakpoint
ALTER TABLE `encounters` ADD `billing_context` text DEFAULT 'routine' NOT NULL;