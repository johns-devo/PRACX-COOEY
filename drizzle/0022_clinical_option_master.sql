CREATE TABLE `clinical_option_master` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`option_group` text NOT NULL,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`value` text NOT NULL,
	`parent_code` text,
	`keywords` text DEFAULT '' NOT NULL,
	`specialty` text DEFAULT 'All specialties' NOT NULL,
	`source` text DEFAULT 'PRACX curated' NOT NULL,
	`version` text DEFAULT '2026.1' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`sort_order` text DEFAULT '100' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_option_org_group_code_unique` ON `clinical_option_master` (`organization_id`,`option_group`,`code`);
--> statement-breakpoint
CREATE INDEX `clinical_option_group_status_idx` ON `clinical_option_master` (`option_group`,`status`);
