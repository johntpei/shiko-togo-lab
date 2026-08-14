CREATE TABLE `context_pack_sessions` (
	`context_pack_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`context_pack_id`, `session_id`),
	FOREIGN KEY (`context_pack_id`) REFERENCES `context_packs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `context_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`theme` text DEFAULT '' NOT NULL,
	`source_review_id` text,
	`markdown` text NOT NULL,
	`payload` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`source_review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text,
	`session_analysis_id` text,
	`session_id` text NOT NULL,
	`message_id` text NOT NULL,
	`quote` text NOT NULL,
	`validated` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_analysis_id`) REFERENCES `session_analyses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`index` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_sessions` (
	`review_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`review_id`, `session_id`),
	FOREIGN KEY (`review_id`) REFERENCES `reviews`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`occurred_at` text NOT NULL,
	`source` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`raw_content` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
