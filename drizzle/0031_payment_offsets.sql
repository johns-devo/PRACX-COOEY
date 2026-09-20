ALTER TABLE `payment_entries` ADD `offset_amount` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_entries` ADD `refund_amount` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_entries` ADD `incentive_amount` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_entries` ADD `other_adjustments` text DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_entries` ADD `payment_total_effective` text DEFAULT '0.00' NOT NULL;
