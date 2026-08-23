CREATE TABLE `concept_incremental_session_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`processing_version` text NOT NULL,
	`processor_version` text NOT NULL,
	`run_version` text NOT NULL,
	`phase` text NOT NULL,
	`prepared_payload` text NOT NULL,
	`last_failure_stage` text,
	`last_failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_incremental_session_runs_session_processing_unique` ON `concept_incremental_session_runs` (`session_id`,`processing_version`);
