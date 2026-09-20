CREATE TABLE `clinical_content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`section` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`specialty` text DEFAULT 'All specialties' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` text DEFAULT '100' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clinical_content_section_status_idx` ON `clinical_content_items` (`section`,`status`);
--> statement-breakpoint
CREATE TABLE `practice_services` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`specialty` text DEFAULT 'All specialties' NOT NULL,
	`procedure_code` text,
	`suggested_diagnosis_codes` text DEFAULT '[]' NOT NULL,
	`documentation_prompts` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`effective_date` text NOT NULL,
	`termination_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `practice_services_org_status_idx` ON `practice_services` (`organization_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `practice_services_org_name_unique` ON `practice_services` (`organization_id`,`name`);
