CREATE TABLE `observation_concept_evidence_supports` (
	`observation_id` text NOT NULL,
	`concept_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`relation_version` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`relation_version`, `observation_id`, `concept_id`, `session_id`, `message_id`, `evidence_ref`),
	FOREIGN KEY (`observation_id`) REFERENCES `observations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
