ALTER TABLE `encounters` ADD `subjective_items_json` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TABLE `subjective_library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`item_type` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`keywords` text DEFAULT '' NOT NULL,
	`specialty` text DEFAULT 'All specialties' NOT NULL,
	`associated_complaints` text DEFAULT '[]' NOT NULL,
	`scope` text DEFAULT 'personal' NOT NULL,
	`approval_status` text DEFAULT 'draft' NOT NULL,
	`created_by_user_id` text,
	`created_by_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subjective_library_org_type_status_idx` ON `subjective_library_items` (`organization_id`,`item_type`,`status`);
--> statement-breakpoint
CREATE INDEX `subjective_library_creator_status_idx` ON `subjective_library_items` (`created_by_user_id`,`status`);
