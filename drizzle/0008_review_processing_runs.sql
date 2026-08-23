CREATE TABLE `review_processing_runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`processing_version` text NOT NULL,
	`phase` text NOT NULL,
	`projected_observation_count` integer,
	`last_failure_stage` text,
	`last_failure_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_processing_runs_review_processing_unique` ON `review_processing_runs` (`review_id`,`processing_version`);
