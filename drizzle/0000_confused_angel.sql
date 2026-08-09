CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_code` text NOT NULL,
	`title` text NOT NULL,
	`organism` text NOT NULL,
	`treatment_variable` text NOT NULL,
	`measurement_type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_experiment_code_unique` ON `experiments` (`experiment_code`);--> statement-breakpoint
CREATE TABLE `measurement_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`measurement_id` text NOT NULL,
	`previous_value` real NOT NULL,
	`revised_value` real NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`sample_id` text NOT NULL,
	`condition` text NOT NULL,
	`organism` text NOT NULL,
	`treatment` text,
	`concentration` real,
	`concentration_unit` text,
	`measurement_type` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`status` text NOT NULL,
	`exclusion_reason` text,
	`input_source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `measurements_experiment_idx` ON `measurements` (`experiment_id`);