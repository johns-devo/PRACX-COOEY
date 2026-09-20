ALTER TABLE `claims` ADD `submission_method` text DEFAULT 'unassigned' NOT NULL;--> statement-breakpoint
ALTER TABLE `claims` ADD `routed_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `printed_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `mailed_at` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `mailed_by_name` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `mail_method` text;--> statement-breakpoint
ALTER TABLE `claims` ADD `mail_tracking_number` text;--> statement-breakpoint
UPDATE `claims` SET `submission_method` = CASE WHEN `submission_mode` = 'paper' THEN 'paper' ELSE 'electronic' END WHERE `submission_method` = 'unassigned' AND `status` IN ('submitted', 'accepted', 'rejected', 'denied', 'paid', 'appealed');--> statement-breakpoint
CREATE INDEX `claims_submission_queue_idx` ON `claims` (`organization_id`,`submission_method`,`status`);
