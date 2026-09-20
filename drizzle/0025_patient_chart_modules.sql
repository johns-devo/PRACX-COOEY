CREATE TABLE `patient_problems` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`code` text,
	`description` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`onset_date` text,
	`resolved_date` text,
	`severity` text DEFAULT '' NOT NULL,
	`notes` text,
	`recorded_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_problems_patient_status_idx` ON `patient_problems` (`patient_id`,`status`);
--> statement-breakpoint
CREATE TABLE `patient_history_items` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`history_type` text NOT NULL,
	`title` text NOT NULL,
	`details` text,
	`onset_year` text,
	`status` text DEFAULT 'active' NOT NULL,
	`recorded_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_history_patient_type_idx` ON `patient_history_items` (`patient_id`,`history_type`);
--> statement-breakpoint
CREATE TABLE `patient_immunizations` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`vaccine_name` text NOT NULL,
	`cvx_code` text,
	`administered_on` text NOT NULL,
	`dose_number` text,
	`site` text,
	`route` text,
	`lot_number` text,
	`manufacturer` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`notes` text,
	`administered_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_immunizations_patient_date_idx` ON `patient_immunizations` (`patient_id`,`administered_on`);
--> statement-breakpoint
CREATE TABLE `patient_flowsheet_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text,
	`metric_key` text NOT NULL,
	`metric_label` text NOT NULL,
	`value` text NOT NULL,
	`unit` text,
	`recorded_at` text NOT NULL,
	`notes` text,
	`recorded_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_flowsheet_patient_metric_idx` ON `patient_flowsheet_entries` (`patient_id`,`metric_key`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `patient_care_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`item_key` text NOT NULL,
	`label` text NOT NULL,
	`category` text DEFAULT 'preventive' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_date` text,
	`completed_at` text,
	`notes` text,
	`updated_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_care_checklist_patient_key_unique` ON `patient_care_checklist_items` (`patient_id`,`item_key`);
--> statement-breakpoint
CREATE INDEX `patient_care_checklist_patient_status_idx` ON `patient_care_checklist_items` (`patient_id`,`status`);
--> statement-breakpoint
CREATE TABLE `patient_recalls` (
	`id` text PRIMARY KEY NOT NULL,
	`patient_id` text NOT NULL,
	`reason` text NOT NULL,
	`due_date` text NOT NULL,
	`priority` text DEFAULT 'routine' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`notes` text,
	`created_by_name` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `patient_recalls_patient_status_due_idx` ON `patient_recalls` (`patient_id`,`status`,`due_date`);
