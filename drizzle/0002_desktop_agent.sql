CREATE TABLE `desktop_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`os` text NOT NULL,
	`arch` text NOT NULL,
	`agent_version` text NOT NULL,
	`protocol_version` text NOT NULL,
	`capabilities` text NOT NULL,
	`displays` text DEFAULT '[]' NOT NULL,
	`permissions` text NOT NULL,
	`availability` text DEFAULT 'idle' NOT NULL,
	`current_run_id` text,
	`last_heartbeat_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_agents_token_hash_unique` ON `desktop_agents` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `desktop_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `desktop_events_run_seq_unique` ON `desktop_events` (`run_id`,`seq`);
--> statement-breakpoint
ALTER TABLE `runs` ADD `executor` text DEFAULT 'playwright' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_agent_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_driver` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_session_state` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_bundle_sha256` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_target` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_preview` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_confirmed_at` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_cancel_requested` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `desktop_last_event_seq` integer DEFAULT 0 NOT NULL;
