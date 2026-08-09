import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Scientific provenance is the product. The schema is shaped so that no fact
 * about an experiment can be changed without leaving a record of who changed
 * it, from what, and why.
 *
 * Five tables, matching the product plan: experiments, samples, measurements,
 * annotations, voice_events — plus measurement_events, which is the audit log
 * that makes "never silently overwrite a measurement" enforceable rather than
 * aspirational.
 */

export const experiments = sqliteTable(
  "experiments",
  {
    id: text("id").primaryKey(),
    experimentCode: text("experiment_code").notNull().unique(),
    title: text("title").notNull(),
    organism: text("organism").notNull(),
    treatmentVariable: text("treatment_variable").notNull(),
    measurementType: text("measurement_type").notNull(),
    status: text("status", { enum: ["draft", "running", "completed"] }).notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("experiments_status_check", sql`${table.status} IN ('draft','running','completed')`),
  ],
);

/**
 * A sample is a physical thing on the bench. Contamination is a property of the
 * sample, not of one reading — "Sample C looks contaminated, exclude it" has to
 * be expressible in one statement.
 */
export const samples = sqliteTable(
  "samples",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id),
    sampleCode: text("sample_code").notNull(),
    condition: text("condition").notNull(),
    organism: text("organism").notNull(),
    treatment: text("treatment"),
    concentration: real("concentration"),
    concentrationUnit: text("concentration_unit"),
    status: text("status", { enum: ["valid", "contaminated", "excluded"] }).notNull(),
    statusReason: text("status_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // One sample code per experiment — "B" must mean exactly one tube.
    unique("samples_experiment_code_unique").on(table.experimentId, table.sampleCode),
    index("samples_experiment_idx").on(table.experimentId),
    check("samples_status_check", sql`${table.status} IN ('valid','contaminated','excluded')`),
  ],
);

export const measurements = sqliteTable(
  "measurements",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id),
    sampleId: text("sample_id").notNull().references(() => samples.id),
    measurementType: text("measurement_type").notNull(),
    value: real("value").notNull(),
    unit: text("unit"),
    status: text("status", { enum: ["valid", "excluded"] }).notNull(),
    exclusionReason: text("exclusion_reason"),
    source: text("source", { enum: ["manual", "voice", "api"] }).notNull(),
    /**
     * Idempotency key supplied by the caller. A voice retry, a double-tap, or a
     * network replay reuses it, so the same spoken observation can never become
     * two rows and silently bend the chart.
     */
    requestId: text("request_id").notNull(),
    recordedAt: text("recorded_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    unique("measurements_request_unique").on(table.experimentId, table.requestId),
    index("measurements_experiment_type_idx").on(table.experimentId, table.measurementType),
    index("measurements_sample_idx").on(table.sampleId),
    check("measurements_status_check", sql`${table.status} IN ('valid','excluded')`),
    check("measurements_source_check", sql`${table.source} IN ('manual','voice','api')`),
  ],
);

/**
 * Append-only. Every mutation of a measurement lands here — corrections,
 * exclusions and restorations alike — carrying the real source of the change.
 */
export const measurementEvents = sqliteTable(
  "measurement_events",
  {
    id: text("id").primaryKey(),
    measurementId: text("measurement_id").notNull().references(() => measurements.id),
    changeType: text("change_type", {
      enum: ["recorded", "value_corrected", "excluded", "restored"],
    }).notNull(),
    previousValue: real("previous_value"),
    revisedValue: real("revised_value"),
    previousStatus: text("previous_status"),
    revisedStatus: text("revised_status"),
    reason: text("reason"),
    source: text("source", { enum: ["manual", "voice", "api"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("measurement_events_measurement_idx").on(table.measurementId),
    check(
      "measurement_events_change_type_check",
      sql`${table.changeType} IN ('recorded','value_corrected','excluded','restored')`,
    ),
    check("measurement_events_source_check", sql`${table.source} IN ('manual','voice','api')`),
  ],
);

export const annotations = sqliteTable(
  "annotations",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id),
    sampleId: text("sample_id").references(() => samples.id),
    measurementId: text("measurement_id").references(() => measurements.id),
    annotationType: text("annotation_type", {
      enum: ["contamination", "note", "flag"],
    }).notNull(),
    content: text("content").notNull(),
    source: text("source", { enum: ["manual", "voice", "api"] }).notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("annotations_experiment_idx").on(table.experimentId),
    check("annotations_type_check", sql`${table.annotationType} IN ('contamination','note','flag')`),
    check("annotations_source_check", sql`${table.source} IN ('manual','voice','api')`),
  ],
);

/**
 * What was said, what the agent understood, and whether it worked. This is what
 * lets the UI show all three at once — and what makes a bad transcription
 * debuggable after the fact instead of lost.
 */
export const voiceEvents = sqliteTable(
  "voice_events",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").references(() => experiments.id),
    intent: text("intent").notNull(),
    rawText: text("raw_text").notNull(),
    parsedPayload: text("parsed_payload"),
    toolName: text("tool_name"),
    success: integer("success", { mode: "boolean" }).notNull(),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("voice_events_experiment_idx").on(table.experimentId)],
);
