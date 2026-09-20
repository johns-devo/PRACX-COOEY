ALTER TABLE `encounters` ADD `template_key` text DEFAULT 'general_soap' NOT NULL;

CREATE TABLE `diagnosis_code_master` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text NOT NULL,
	`code_set` text DEFAULT 'ICD-10-CM' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `diagnosis_code_master_code_unique` ON `diagnosis_code_master` (`code`);

CREATE TABLE `clinical_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`order_type` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`instructions` text,
	`priority` text DEFAULT 'routine' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`ordered_by_user_id` text,
	`ordered_by_name` text NOT NULL,
	`ordered_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ordered_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
CREATE INDEX `clinical_orders_encounter_idx` ON `clinical_orders` (`encounter_id`,`order_type`);
