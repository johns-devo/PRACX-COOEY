ALTER TABLE `claims` ADD `batch_id` text;--> statement-breakpoint
CREATE TABLE `claim_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`batch_number` text NOT NULL,
	`payer_id` text,
	`batch_type` text DEFAULT 'edi' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claim_count` text DEFAULT '0' NOT NULL,
	`total_charge` text DEFAULT '0.00' NOT NULL,
	`edi_file_name` text,
	`edi_file_path` text,
	`edi_content` text,
	`proof_file_name` text,
	`proof_file_path` text,
	`proof_content` text,
	`clearinghouse_response` text,
	`transmitted_at` text,
	`transmitted_by_name` text,
	`created_by_user_id` text,
	`created_by_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`),
	FOREIGN KEY (`payer_id`) REFERENCES `payers`(`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `claim_batches_org_number_unique` ON `claim_batches` (`organization_id`,`batch_number`);--> statement-breakpoint
CREATE INDEX `claim_batches_status_idx` ON `claim_batches` (`organization_id`,`status`,`batch_type`);--> statement-breakpoint
CREATE TABLE `claim_batch_members` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `claim_batches`(`id`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`)
);--> statement-breakpoint
CREATE UNIQUE INDEX `claim_batch_member_unique` ON `claim_batch_members` (`batch_id`,`claim_id`);--> statement-breakpoint
CREATE INDEX `claim_batch_members_claim_idx` ON `claim_batch_members` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claim_transmission_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`transmission_time` text NOT NULL,
	`clearinghouse_response` text,
	`status` text DEFAULT 'sent' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `claim_batches`(`id`)
);--> statement-breakpoint
CREATE INDEX `claim_transmission_logs_batch_idx` ON `claim_transmission_logs` (`batch_id`,`transmission_time`);--> statement-breakpoint
CREATE INDEX `claims_batch_idx` ON `claims` (`batch_id`);
