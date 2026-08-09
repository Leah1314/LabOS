import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { experiments, measurementRevisions, measurements } from "../../db/schema";
import type { ExperimentSnapshot, RecordMeasurementInput } from "./types";

const EXPERIMENT_ID = "exp-042";

async function ensureSchema() {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, experiment_code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, organism TEXT NOT NULL, treatment_variable TEXT NOT NULL, measurement_type TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','running','completed')), started_at TEXT NOT NULL, ended_at TEXT, created_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS measurements (id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id), sample_id TEXT NOT NULL, condition TEXT NOT NULL, organism TEXT NOT NULL, treatment TEXT, concentration REAL, concentration_unit TEXT, measurement_type TEXT NOT NULL, value REAL NOT NULL, unit TEXT, status TEXT NOT NULL CHECK(status IN ('valid','excluded')), exclusion_reason TEXT, input_source TEXT NOT NULL CHECK(input_source IN ('manual','voice','api')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS measurements_experiment_idx ON measurements(experiment_id)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS measurement_revisions (id TEXT PRIMARY KEY, measurement_id TEXT NOT NULL REFERENCES measurements(id), previous_value REAL NOT NULL, revised_value REAL NOT NULL, source TEXT NOT NULL CHECK(source IN ('manual','voice','api')), created_at TEXT NOT NULL)`),
  ]);
}

export async function createExperiment() {
  await ensureSchema();
  const db = getDb();
  const existing = await db.select().from(experiments).where(eq(experiments.id, EXPERIMENT_ID)).limit(1);
  if (existing.length) return existing[0];
  const now = new Date().toISOString();
  const [experiment] = await db.insert(experiments).values({
    id: EXPERIMENT_ID,
    experimentCode: "EXP-042",
    title: "Inulin effect on Bifidobacterium growth",
    organism: "Bifidobacterium",
    treatmentVariable: "Inulin concentration",
    measurementType: "OD600",
    status: "running",
    startedAt: now,
    endedAt: null,
    createdAt: now,
  }).returning();
  return experiment;
}

export async function getMeasurementsForExperiment(): Promise<ExperimentSnapshot> {
  const experiment = await createExperiment();
  const rows = await getDb().select().from(measurements).where(eq(measurements.experimentId, EXPERIMENT_ID));
  return { experiment, measurements: rows };
}

export async function recordMeasurement(input: RecordMeasurementInput) {
  if (!input.sampleId.trim() || !input.condition.trim() || !input.measurementType.trim()) throw new Error("Sample, condition, and measurement type are required.");
  if (!Number.isFinite(input.value) || input.value < 0) throw new Error("Value must be a non-negative number.");
  await createExperiment();
  const now = new Date().toISOString();
  await getDb().insert(measurements).values({ ...input, id: crypto.randomUUID(), status: "valid", treatment: input.treatment ?? null, concentration: input.concentration ?? null, concentrationUnit: input.concentrationUnit ?? null, unit: input.unit ?? null, exclusionReason: null, createdAt: now, updatedAt: now });
  return getMeasurementsForExperiment();
}

export async function correctMeasurement(measurementId: string, value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error("Corrected value must be a non-negative number.");
  const db = getDb();
  const matches = await db.select().from(measurements).where(eq(measurements.id, measurementId)).limit(2);
  if (matches.length !== 1) throw new Error(matches.length ? "Correction is ambiguous." : "Measurement not found.");
  const now = new Date().toISOString();
  await db.batch([
    db.insert(measurementRevisions).values({ id: crypto.randomUUID(), measurementId, previousValue: matches[0].value, revisedValue: value, source: "manual", createdAt: now }),
    db.update(measurements).set({ value, updatedAt: now }).where(eq(measurements.id, measurementId)),
  ]);
  return getMeasurementsForExperiment();
}

export async function excludeMeasurement(measurementId: string, reason: string) {
  if (!reason.trim()) throw new Error("An exclusion reason is required.");
  await getDb().update(measurements).set({ status: "excluded", exclusionReason: reason.trim(), updatedAt: new Date().toISOString() }).where(eq(measurements.id, measurementId));
  return getMeasurementsForExperiment();
}

export async function restoreMeasurement(measurementId: string) {
  await getDb().update(measurements).set({ status: "valid", exclusionReason: null, updatedAt: new Date().toISOString() }).where(eq(measurements.id, measurementId));
  return getMeasurementsForExperiment();
}

export async function seedDemoMeasurements() {
  const snapshot = await getMeasurementsForExperiment();
  if (snapshot.measurements.length) return snapshot;
  const demo = [
    { sampleId: "A", condition: "Control", concentration: 0, value: 0.41 },
    { sampleId: "B", condition: "1% Inulin", concentration: 1, value: 0.53 },
    { sampleId: "C", condition: "2% Inulin", concentration: 2, value: 0.68 },
  ];
  for (const item of demo) await recordMeasurement({ experimentId: EXPERIMENT_ID, organism: "Bifidobacterium", treatment: item.concentration ? "Inulin" : null, concentrationUnit: "%", measurementType: "OD600", unit: "OD", inputSource: "manual", ...item });
  return getMeasurementsForExperiment();
}
