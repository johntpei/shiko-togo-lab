CREATE TABLE `concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_label` text NOT NULL,
	`normalized_key` text NOT NULL,
	`matching_version` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concepts_normalized_key_unique` ON `concepts` (`normalized_key`);
--> statement-breakpoint
CREATE TABLE `concept_aliases` (
	`concept_id` text NOT NULL,
	`alias_label` text NOT NULL,
	`normalized_alias` text NOT NULL,
	PRIMARY KEY(`concept_id`, `normalized_alias`),
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `concept_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`concept_id` text NOT NULL,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`evidence_ref` text NOT NULL,
	`occurred_at` text NOT NULL,
	`source_role` text NOT NULL,
	`source_type` text NOT NULL,
	`extraction_version` text NOT NULL,
	FOREIGN KEY (`concept_id`) REFERENCES `concepts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concept_occurrences_identity_unique` ON `concept_occurrences` (`extraction_version`,`source_type`,`message_id`,`evidence_ref`,`concept_id`);
