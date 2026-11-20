CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`actor_name` text DEFAULT '' NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`actor` text NOT NULL,
	`key` text NOT NULL,
	`endpoint` text NOT NULL,
	`body_hash` text NOT NULL,
	`status` integer NOT NULL,
	`response` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`actor`, `key`)
);
