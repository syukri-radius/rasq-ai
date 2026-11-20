ALTER TABLE `api_keys` ADD `project_ids` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD `daily_mutation_limit` integer;
--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`key_id` text NOT NULL,
	`period` text NOT NULL,
	`bucket` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`key_id`, `period`, `bucket`),
	FOREIGN KEY (`key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade
);
