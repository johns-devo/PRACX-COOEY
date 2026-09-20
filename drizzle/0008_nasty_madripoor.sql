PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_billing_responsibility_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`profile_name` text NOT NULL,
	`billing_context` text DEFAULT 'routine' NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
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
INSERT INTO `__new_billing_responsibility_profiles`("id", "patient_id", "profile_name", "billing_context", "effective_from", "effective_to", "verification_status", "guarantor_type", "guarantor_name", "patient_billing_hold", "reason", "status", "created_at", "updated_at") SELECT "id", "patient_id", "profile_name", "billing_context", "effective_from", "effective_to", "verification_status", "guarantor_type", "guarantor_name", "patient_billing_hold", "reason", "status", "created_at", "updated_at" FROM `billing_responsibility_profiles`;--> statement-breakpoint
DROP TABLE `billing_responsibility_profiles`;--> statement-breakpoint
ALTER TABLE `__new_billing_responsibility_profiles` RENAME TO `billing_responsibility_profiles`;--> statement-breakpoint
UPDATE `billing_responsibility_profiles` SET `verification_status` = 'unverified' WHERE `verification_status` = 'reported';--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `responsibility_profile_patient_dos_idx` ON `billing_responsibility_profiles` (`patient_id`,`billing_context`,`effective_from`);
