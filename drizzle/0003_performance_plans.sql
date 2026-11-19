CREATE TABLE `performance_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `case_id` text,
  `config` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`case_id`) REFERENCES `test_cases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `performance_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `status` text DEFAULT 'running' NOT NULL,
  `summary` text,
  `error` text DEFAULT '' NOT NULL,
  `started_at` integer NOT NULL,
  `completed_at` integer,
  FOREIGN KEY (`plan_id`) REFERENCES `performance_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
