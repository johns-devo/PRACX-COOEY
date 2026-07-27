CREATE TABLE `facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`facility_type` text NOT NULL,
	`npi` text,
	`clia_number` text,
	`phone` text,
	`email` text,
	`timezone` text DEFAULT 'America/New_York' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_org_code_unique` ON `facilities` (`organization_id`,`code`);--> statement-breakpoint
CREATE INDEX `facilities_org_status_idx` ON `facilities` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`dba_name` text,
	`organization_npi` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `service_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`name` text NOT NULL,
	`place_of_service_code` text NOT NULL,
	`address_line_1` text NOT NULL,
	`address_line_2` text,
	`city` text NOT NULL,
	`state` text NOT NULL,
	`postal_code` text NOT NULL,
	`is_primary` text DEFAULT 'yes' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `service_locations_facility_idx` ON `service_locations` (`facility_id`);
--> statement-breakpoint
INSERT INTO `organizations` (`id`, `legal_name`, `dba_name`, `organization_npi`, `status`)
VALUES ('org_pracx_health', 'PRACX Health Network, PLLC', 'PRACX Care', '1487926305', 'active');
--> statement-breakpoint
INSERT INTO `facilities` (`id`, `organization_id`, `name`, `code`, `facility_type`, `npi`, `phone`, `timezone`, `status`)
VALUES
  ('fac_midtown', 'org_pracx_health', 'Midtown Medical Center', 'MIDTOWN', 'Medical office', '1487926313', '(212) 555-0184', 'America/New_York', 'active'),
  ('fac_riverside', 'org_pracx_health', 'Riverside Specialty Clinic', 'RIVER', 'Independent clinic', '1487926321', '(201) 555-0132', 'America/New_York', 'active');
--> statement-breakpoint
INSERT INTO `service_locations` (`id`, `facility_id`, `name`, `place_of_service_code`, `address_line_1`, `city`, `state`, `postal_code`, `is_primary`, `status`)
VALUES
  ('loc_midtown_main', 'fac_midtown', 'Main service location', '11', '315 Madison Avenue', 'New York', 'NY', '10017', 'yes', 'active'),
  ('loc_riverside_main', 'fac_riverside', 'Riverside service location', '49', '820 River Road', 'Edgewater', 'NJ', '07020', 'yes', 'active');
