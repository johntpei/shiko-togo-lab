CREATE TABLE `concept_processing_checkpoints` (
	`session_id` text NOT NULL,
	`processing_version` text NOT NULL,
	`completed_at` text NOT NULL,
	`existing_match_count` integer NOT NULL,
	`new_candidate_count` integer NOT NULL,
	`provisional_new_count` integer NOT NULL,
	`grounding_rejected_count` integer NOT NULL,
	PRIMARY KEY(`session_id`, `processing_version`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
