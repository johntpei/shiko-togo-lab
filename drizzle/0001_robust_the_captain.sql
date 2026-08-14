CREATE TABLE `source_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_conversation_id` text NOT NULL,
	`title` text NOT NULL,
	`source_created_at` text,
	`source_updated_at` text,
	`is_archived` integer DEFAULT false NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_conversations_external_id_unique` ON `source_conversations` (`source`,`external_conversation_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `source_message_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `source_created_at` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `content_type` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `attachments_json` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_conversation_id` text REFERENCES source_conversations(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `import_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_start_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_end_at` text;