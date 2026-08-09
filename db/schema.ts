import { index, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const experiments = sqliteTable("experiments", {
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
});

export const measurements = sqliteTable(
  "measurements",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id),
    sampleId: text("sample_id").notNull(),
    condition: text("condition").notNull(),
    organism: text("organism").notNull(),
    treatment: text("treatment"),
    concentration: real("concentration"),
    concentrationUnit: text("concentration_unit"),
    measurementType: text("measurement_type").notNull(),
    value: real("value").notNull(),
    unit: text("unit"),
    status: text("status", { enum: ["valid", "excluded"] }).notNull(),
    exclusionReason: text("exclusion_reason"),
    inputSource: text("input_source", { enum: ["manual", "voice", "api"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("measurements_experiment_idx").on(table.experimentId)],
);

export const measurementRevisions = sqliteTable("measurement_revisions", {
  id: text("id").primaryKey(),
  measurementId: text("measurement_id").notNull().references(() => measurements.id),
  previousValue: real("previous_value").notNull(),
  revisedValue: real("revised_value").notNull(),
  source: text("source", { enum: ["manual", "voice", "api"] }).notNull(),
  createdAt: text("created_at").notNull(),
});
