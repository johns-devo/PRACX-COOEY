ALTER TABLE `claims` ADD `workflow_status` text DEFAULT 'needs_scrub' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `last_scrubbed_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `scrub_result` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `scrub_rules_checked` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `scrub_error_count` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `scrubbed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `scrubbed_by_name` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generation_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generated_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generated_by_user_id` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generated_by_name` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `claim_format` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generation_result` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `generated_transaction_ref` text;--> statement-breakpoint
CREATE TABLE `claim_workflow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`action` text NOT NULL,
	`reason` text,
	`error_information` text,
	`actor_user_id` text,
	`actor_name` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`)
);--> statement-breakpoint
CREATE INDEX `claim_workflow_events_claim_idx` ON `claim_workflow_events` (`claim_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `claims_workflow_status_idx` ON `claims` (`organization_id`,`workflow_status`);--> statement-breakpoint
UPDATE `claims` SET `workflow_status` = CASE
  WHEN `status` IN ('submitted', 'accepted', 'rejected', 'paid', 'denied', 'appealed') THEN 'submitted'
  WHEN `status` = 'scrub_error' OR `scrubber_status` = 'errors' THEN 'error'
  WHEN `scrubber_status` = 'clean' OR `status` = 'ready' THEN 'ready_to_bill'
  ELSE 'needs_scrub'
END;
