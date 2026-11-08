CREATE TABLE `ai_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'openai' NOT NULL,
	`base_url` text DEFAULT '' NOT NULL,
	`api_key_env` text DEFAULT '' NOT NULL,
	`models` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `controls` (
	`id` text PRIMARY KEY NOT NULL,
	`screen_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`w` integer NOT NULL,
	`h` integer NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`locator_hash` text DEFAULT '' NOT NULL,
	`perception_label` text DEFAULT '' NOT NULL,
	`ai_model` text,
	`source` text DEFAULT 'perception' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `model_routes` (
	`task` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'system' NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`surface` text DEFAULT 'web' NOT NULL,
	`target_url` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text DEFAULT 'video/webm' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`file_path` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `requirement_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text DEFAULT 'text/plain' NOT NULL,
	`sha256` text DEFAULT '' NOT NULL,
	`text` text NOT NULL,
	`analysis_model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_id` text NOT NULL,
	`req_key` text NOT NULL,
	`text` text NOT NULL,
	`acceptance` text DEFAULT '[]' NOT NULL,
	`category` text DEFAULT 'functional' NOT NULL,
	`ambiguity` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `requirement_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `run_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`node_id` text NOT NULL,
	`node_name` text NOT NULL,
	`node_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`evidence` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`mode` text DEFAULT 'playwright' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`target_url` text DEFAULT '' NOT NULL,
	`error` text,
	`summary` text DEFAULT '{}' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `screens` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recording_id` text,
	`name` text NOT NULL,
	`group_key` text DEFAULT 'grp-1' NOT NULL,
	`source` text DEFAULT 'screenshot' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`image_path` text NOT NULL,
	`frame_count` integer DEFAULT 1 NOT NULL,
	`timestamp_ms` integer DEFAULT 0 NOT NULL,
	`perception_model` text NOT NULL,
	`ai_model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`case_key` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`preconditions` text DEFAULT '[]' NOT NULL,
	`test_data` text DEFAULT '{}' NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`expected` text NOT NULL,
	`assumptions` text DEFAULT '[]' NOT NULL,
	`provenance` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `test_traceability` (
	`test_case_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	PRIMARY KEY(`test_case_id`, `requirement_id`),
	FOREIGN KEY (`test_case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`n8n` text NOT NULL,
	`provenance` text DEFAULT 'manual' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
