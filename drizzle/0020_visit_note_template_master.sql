CREATE TABLE `visit_note_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`specialty` text DEFAULT 'Primary Care' NOT NULL,
	`template_json` text DEFAULT '{}' NOT NULL,
	`suggested_diagnosis_codes` text DEFAULT '[]' NOT NULL,
	`suggested_procedure_codes` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visit_note_templates_org_status_idx` ON `visit_note_templates` (`organization_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `visit_note_templates_org_name_unique` ON `visit_note_templates` (`organization_id`,`name`);
