CREATE TABLE `provider_facility_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`is_primary` text DEFAULT 'yes' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_facility_unique` ON `provider_facility_assignments` (`provider_id`,`facility_id`);--> statement-breakpoint
CREATE INDEX `provider_facility_provider_idx` ON `provider_facility_assignments` (`provider_id`);--> statement-breakpoint
CREATE TABLE `provider_licenses` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`state` text NOT NULL,
	`license_number` text NOT NULL,
	`expiration_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_license_unique` ON `provider_licenses` (`provider_id`,`state`,`license_number`);--> statement-breakpoint
CREATE INDEX `provider_license_provider_idx` ON `provider_licenses` (`provider_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`provider_code` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`credentials` text,
	`npi` text,
	`taxonomy_code` text,
	`specialty` text NOT NULL,
	`email` text,
	`phone` text,
	`is_billing` text DEFAULT 'no' NOT NULL,
	`is_rendering` text DEFAULT 'yes' NOT NULL,
	`is_supervising` text DEFAULT 'no' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `providers_org_code_unique` ON `providers` (`organization_id`,`provider_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `providers_npi_unique` ON `providers` (`npi`);--> statement-breakpoint
CREATE INDEX `providers_org_status_idx` ON `providers` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `referring_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`credentials` text,
	`npi` text,
	`taxonomy_code` text,
	`specialty` text NOT NULL,
	`organization_name` text,
	`email` text,
	`phone` text,
	`fax` text,
	`address_line_1` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referring_providers_npi_unique` ON `referring_providers` (`npi`);--> statement-breakpoint
CREATE INDEX `referring_providers_org_status_idx` ON `referring_providers` (`organization_id`,`status`);