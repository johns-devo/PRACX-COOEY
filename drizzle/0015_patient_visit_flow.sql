ALTER TABLE `appointments` ADD `flow_status` text DEFAULT 'not_arrived' NOT NULL;--> statement-breakpoint
ALTER TABLE `appointments` ADD `room_name` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `flow_status_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `arrived_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `checked_in_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `waiting_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `roomed_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `ready_for_provider_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `consultation_started_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `consultation_ended_at` text;--> statement-breakpoint
ALTER TABLE `appointments` ADD `checked_out_at` text;--> statement-breakpoint
CREATE TABLE `visit_flow_events` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`room_name` text,
	`note` text,
	`changed_by_user_id` text,
	`changed_by_name` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`appointment_id`) REFERENCES `appointments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `visit_flow_appointment_time_idx` ON `visit_flow_events` (`appointment_id`,`occurred_at`);
