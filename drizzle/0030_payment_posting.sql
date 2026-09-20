CREATE TABLE `payment_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`payment_number` text NOT NULL,
	`payer_id` text,
	`remittance_id` text,
	`payment_amount` text DEFAULT '0.00' NOT NULL,
	`payment_method` text DEFAULT 'Check' NOT NULL,
	`reference_number` text,
	`payment_date` text NOT NULL,
	`notes` text,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`claim_count` text DEFAULT '0' NOT NULL,
	`posted_claim_count` text DEFAULT '0' NOT NULL,
	`claim_paid_total` text DEFAULT '0.00' NOT NULL,
	`auto_post_result` text,
	`error_message` text,
	`created_by_user_id` text,
	`created_by_name` text NOT NULL,
	`posted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_entries_org_number_unique` ON `payment_entries` (`organization_id`,`payment_number`);--> statement-breakpoint
CREATE INDEX `payment_entries_status_idx` ON `payment_entries` (`organization_id`,`payment_status`);--> statement-breakpoint
CREATE INDEX `payment_entries_payer_idx` ON `payment_entries` (`payer_id`,`payment_date`);--> statement-breakpoint
CREATE TABLE `claim_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`allowed_amount` text DEFAULT '0.00' NOT NULL,
	`paid_amount` text DEFAULT '0.00' NOT NULL,
	`adjustment_amount` text DEFAULT '0.00' NOT NULL,
	`patient_responsibility` text DEFAULT '0.00' NOT NULL,
	`denial_code` text,
	`posting_status` text DEFAULT 'pending' NOT NULL,
	`error_message` text,
	`posted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment_entries`(`id`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `claim_payments_payment_claim_unique` ON `claim_payments` (`payment_id`,`claim_id`);--> statement-breakpoint
CREATE INDEX `claim_payments_claim_idx` ON `claim_payments` (`claim_id`);--> statement-breakpoint
CREATE INDEX `claim_payments_status_idx` ON `claim_payments` (`payment_id`,`posting_status`);--> statement-breakpoint
CREATE TABLE `payment_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`claim_id` text,
	`action_type` text NOT NULL,
	`message` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment_entries`(`id`)
);--> statement-breakpoint
CREATE INDEX `payment_logs_payment_idx` ON `payment_logs` (`payment_id`,`created_at`);
