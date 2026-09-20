CREATE TABLE `claim_configuration_history` (
	`id` text PRIMARY KEY NOT NULL,
	`configuration_id` text NOT NULL,
	`action` text NOT NULL,
	`before_snapshot` text,
	`after_snapshot` text NOT NULL,
	`changed_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`configuration_id`) REFERENCES `claim_configuration_values`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `claim_config_history_config_idx` ON `claim_configuration_history` (`configuration_id`);--> statement-breakpoint
CREATE TABLE `claim_configuration_values` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`internal_guidance` text,
	`source` text DEFAULT 'NUCC 1500 v13.0 7/25' NOT NULL,
	`is_official` text DEFAULT 'yes' NOT NULL,
	`payer_id` text,
	`effective_date` text,
	`termination_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claim_config_category_code_payer_unique` ON `claim_configuration_values` (`category`,`code`,`payer_id`);--> statement-breakpoint
CREATE INDEX `claim_config_category_status_idx` ON `claim_configuration_values` (`category`,`status`);