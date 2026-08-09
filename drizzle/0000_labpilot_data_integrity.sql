CREATE TABLE `annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`sample_id` text,
	`measurement_id` text,
	`annotation_type` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sample_id`) REFERENCES `samples`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "annotations_type_check" CHECK("annotations"."annotation_type" IN ('contamination','note','flag')),
	CONSTRAINT "annotations_source_check" CHECK("annotations"."source" IN ('manual','voice','api'))
);
--> statement-breakpoint
CREATE INDEX `annotations_experiment_idx` ON `annotations` (`experiment_id`);--> statement-breakpoint
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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "experiments_status_check" CHECK("experiments"."status" IN ('draft','running','completed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_experiment_code_unique` ON `experiments` (`experiment_code`);--> statement-breakpoint
CREATE TABLE `measurement_events` (
	`id` text PRIMARY KEY NOT NULL,
	`measurement_id` text NOT NULL,
	`change_type` text NOT NULL,
	`previous_value` real,
	`revised_value` real,
	`previous_status` text,
	`revised_status` text,
	`reason` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "measurement_events_change_type_check" CHECK("measurement_events"."change_type" IN ('recorded','value_corrected','excluded','restored')),
	CONSTRAINT "measurement_events_source_check" CHECK("measurement_events"."source" IN ('manual','voice','api'))
);
--> statement-breakpoint
CREATE INDEX `measurement_events_measurement_idx` ON `measurement_events` (`measurement_id`);--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`sample_id` text NOT NULL,
	`measurement_type` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`status` text NOT NULL,
	`exclusion_reason` text,
	`source` text NOT NULL,
	`request_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sample_id`) REFERENCES `samples`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "measurements_status_check" CHECK("measurements"."status" IN ('valid','excluded')),
	CONSTRAINT "measurements_source_check" CHECK("measurements"."source" IN ('manual','voice','api'))
);
--> statement-breakpoint
CREATE INDEX `measurements_experiment_type_idx` ON `measurements` (`experiment_id`,`measurement_type`);--> statement-breakpoint
CREATE INDEX `measurements_sample_idx` ON `measurements` (`sample_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `measurements_request_unique` ON `measurements` (`experiment_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `samples` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`sample_code` text NOT NULL,
	`condition` text NOT NULL,
	`organism` text NOT NULL,
	`treatment` text,
	`concentration` real,
	`concentration_unit` text,
	`status` text NOT NULL,
	`status_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "samples_status_check" CHECK("samples"."status" IN ('valid','contaminated','excluded'))
);
--> statement-breakpoint
CREATE INDEX `samples_experiment_idx` ON `samples` (`experiment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `samples_experiment_code_unique` ON `samples` (`experiment_id`,`sample_code`);--> statement-breakpoint
CREATE TABLE `voice_events` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text,
	`intent` text NOT NULL,
	`raw_text` text NOT NULL,
	`parsed_payload` text,
	`tool_name` text,
	`success` integer NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `voice_events_experiment_idx` ON `voice_events` (`experiment_id`);