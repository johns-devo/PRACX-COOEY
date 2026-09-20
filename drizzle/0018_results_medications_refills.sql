CREATE TABLE `clinical_order_results` (
  `id` text PRIMARY KEY NOT NULL,
  `order_id` text NOT NULL REFERENCES `clinical_orders`(`id`),
  `encounter_id` text NOT NULL REFERENCES `encounters`(`id`),
  `patient_id` text NOT NULL REFERENCES `patients`(`id`),
  `result_type` text NOT NULL,
  `result_status` text DEFAULT 'final' NOT NULL,
  `summary` text NOT NULL,
  `result_data` text,
  `abnormal_flag` text DEFAULT 'unknown' NOT NULL,
  `review_status` text DEFAULT 'pending' NOT NULL,
  `resulted_at` text NOT NULL,
  `created_by_user_id` text REFERENCES `users`(`id`),
  `created_by_name` text NOT NULL,
  `reviewed_at` text,
  `reviewed_by_user_id` text REFERENCES `users`(`id`),
  `reviewed_by_name` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `clinical_order_results_order_time_idx` ON `clinical_order_results` (`order_id`, `resulted_at`);

CREATE TABLE `patient_medications` (
  `id` text PRIMARY KEY NOT NULL,
  `patient_id` text NOT NULL REFERENCES `patients`(`id`),
  `encounter_id` text REFERENCES `encounters`(`id`),
  `source_order_id` text REFERENCES `clinical_orders`(`id`),
  `medication_name` text NOT NULL,
  `rx_norm_code` text,
  `dose` text,
  `route` text,
  `frequency` text,
  `instructions` text,
  `status` text DEFAULT 'active' NOT NULL,
  `start_date` text,
  `end_date` text,
  `prescribed_by_user_id` text REFERENCES `users`(`id`),
  `prescribed_by_name` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `patient_medications_patient_status_idx` ON `patient_medications` (`patient_id`, `status`);
CREATE UNIQUE INDEX `patient_medications_source_order_unique` ON `patient_medications` (`source_order_id`);

CREATE TABLE `refill_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `medication_id` text NOT NULL REFERENCES `patient_medications`(`id`),
  `patient_id` text NOT NULL REFERENCES `patients`(`id`),
  `status` text DEFAULT 'pending' NOT NULL,
  `requested_by` text NOT NULL,
  `requested_at` text NOT NULL,
  `notes` text,
  `decided_by_user_id` text REFERENCES `users`(`id`),
  `decided_by_name` text,
  `decided_at` text,
  `decision_notes` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text NOT NULL
);
CREATE INDEX `refill_requests_patient_status_idx` ON `refill_requests` (`patient_id`, `status`);
