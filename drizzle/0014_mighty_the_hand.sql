ALTER TABLE `patient_documents` ADD `analysis_status` text DEFAULT 'not_analyzed' NOT NULL;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `analysis_json` text;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `analysis_model` text;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `analyzed_at` text;--> statement-breakpoint
ALTER TABLE `patient_documents` ADD `analyzed_by` text;