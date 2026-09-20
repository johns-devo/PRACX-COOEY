CREATE TABLE `clinical_order_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`order_type` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'General' NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`specimen_or_modality` text DEFAULT '' NOT NULL,
	`sort_order` text DEFAULT '100' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_order_catalog_type_code_unique` ON `clinical_order_catalog` (`order_type`,`code`);
--> statement-breakpoint
CREATE INDEX `clinical_order_catalog_type_status_idx` ON `clinical_order_catalog` (`order_type`,`status`);
