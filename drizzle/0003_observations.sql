CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`projection_version` text NOT NULL,
	`source_review_id` text NOT NULL,
	`source_ref` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`support_type` text,
	`payload` text NOT NULL,
	`first_seen_at` text,
	`last_seen_at` text,
	`detected_at` text NOT NULL,
	`distinct_session_count` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observations_source_identity_unique` ON `observations` (`source_review_id`,`source_ref`,`projection_version`);
--> statement-breakpoint
CREATE TABLE `observation_sessions` (
	`observation_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`observation_id`, `session_id`),
	FOREIGN KEY (`observation_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
