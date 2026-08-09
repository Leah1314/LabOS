import { env } from "cloudflare:workers";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../../db";
import { ensureSchema } from "../../db/bootstrap";
import {
  annotations,
  experiments,
  measurementEvents,
  measurements,
  samples,
  voiceEvents,
} from "../../db/schema";
import { summarizeByCondition } from "./analytics";
import type {
  Annotation,
  Experiment,
  ExperimentSnapshot,
  MeasurementEvent,
  MeasurementView,
  Sample,
  VoiceEventRecord,
} from "./types";
import type {
  AnnotateSampleInput,
  CorrectMeasurementInput,
  RecordMeasurementInput,
  ResolveMeasurementInput,
  RestoreMeasurementInput,
  StartExperimentInput,
  VoiceEventInput,
} from "./validation";

export const DEMO_EXPERIMENT_ID = "exp-042";

/** Two identical readings for one sample this close together are a replay, not science. */
const DUPLICATE_WINDOW_MS = 60_000;

export class LabPilotError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LabPilotError";
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

/* ---------------------------------------------------------------- experiment */

const DEMO_EXPERIMENT: StartExperimentInput & { id: string } = {
  id: DEMO_EXPERIMENT_ID,
  experimentCode: "EXP-042",
  title: "Inulin effect on Bifidobacterium growth",
  organism: "Bifidobacterium",
  treatmentVariable: "Inulin concentration",
  measurementType: "OD600",
  source: "manual",
};

/**
 * Insert-or-ignore rather than select-then-insert. The old check-then-insert
 * raced: two concurrent first requests both saw "missing" and the loser hit the
 * unique constraint on experiment_code and 500'd.
 */
export async function ensureExperiment(
  input: StartExperimentInput & { id?: string } = DEMO_EXPERIMENT,
): Promise<Experiment> {
  await ensureSchema();
  const db = getDb();
  const stamp = now();
  const experimentId = input.id ?? id();

  await db
    .insert(experiments)
    .values({
      id: experimentId,
      experimentCode: input.experimentCode,
      title: input.title,
      organism: input.organism,
      treatmentVariable: input.treatmentVariable,
      measurementType: input.measurementType,
      status: "running",
      startedAt: stamp,
      endedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoNothing();

  const [experiment] = await db
    .select()
    .from(experiments)
    .where(eq(experiments.experimentCode, input.experimentCode))
    .limit(1);

  if (!experiment) {
    throw new LabPilotError("Could not create or load the experiment.", 500, "experiment_unavailable");
  }
  return experiment;
}

export const startExperiment = (input: StartExperimentInput) => ensureExperiment(input);

async function requireExperiment(experimentId: string): Promise<Experiment> {
  await ensureSchema();
  const [experiment] = await getDb()
    .select()
    .from(experiments)
    .where(eq(experiments.id, experimentId))
    .limit(1);
  if (!experiment) {
    throw new LabPilotError(`Experiment ${experimentId} does not exist.`, 404, "experiment_not_found");
  }
  return experiment;
}

/* ------------------------------------------------------------------ snapshot */

function toView(row: { measurement: typeof measurements.$inferSelect; sample: Sample }): MeasurementView {
  const sampleUsable = row.sample.status === "valid";
  return {
    id: row.measurement.id,
    experimentId: row.measurement.experimentId,
    sampleId: row.sample.sampleCode,
    sampleRowId: row.sample.id,
    condition: row.sample.condition,
    organism: row.sample.organism,
    treatment: row.sample.treatment,
    concentration: row.sample.concentration,
    concentrationUnit: row.sample.concentrationUnit,
    measurementType: row.measurement.measurementType,
    value: row.measurement.value,
    unit: row.measurement.unit,
    status: row.measurement.status,
    exclusionReason: row.measurement.exclusionReason,
    sampleStatus: row.sample.status,
    effectiveStatus: row.measurement.status === "valid" && sampleUsable ? "valid" : "excluded",
    source: row.measurement.source,
    requestId: row.measurement.requestId,
    recordedAt: row.measurement.recordedAt,
    createdAt: row.measurement.createdAt,
    updatedAt: row.measurement.updatedAt,
  };
}

/** Bounded so a long-lived demo cannot turn a 1s poll into an unbounded payload. */
const AUDIT_EVENT_LIMIT = 200;
const VOICE_EVENT_LIMIT = 12;

export async function getSnapshot(experimentId = DEMO_EXPERIMENT_ID): Promise<ExperimentSnapshot> {
  const experiment = await requireExperiment(experimentId);
  const db = getDb();

  const [sampleRows, measurementRows, annotationRows, eventRows, voiceRows] = await Promise.all([
    db.select().from(samples).where(eq(samples.experimentId, experimentId)),
    db
      .select({ measurement: measurements, sample: samples })
      .from(measurements)
      .innerJoin(samples, eq(measurements.sampleId, samples.id))
      .where(eq(measurements.experimentId, experimentId)),
    db.select().from(annotations).where(eq(annotations.experimentId, experimentId)),
    db
      .select({ event: measurementEvents })
      .from(measurementEvents)
      .innerJoin(measurements, eq(measurementEvents.measurementId, measurements.id))
      .where(eq(measurements.experimentId, experimentId))
      .orderBy(desc(measurementEvents.createdAt))
      .limit(AUDIT_EVENT_LIMIT),
    db
      .select()
      .from(voiceEvents)
      .where(eq(voiceEvents.experimentId, experimentId))
      .orderBy(desc(voiceEvents.createdAt))
      .limit(VOICE_EVENT_LIMIT),
  ]);

  const views = measurementRows
    .map(toView)
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

  return {
    experiment,
    samples: sampleRows,
    measurements: views,
    annotations: annotationRows as Annotation[],
    summary: summarizeByCondition(views),
    events: eventRows.map((row) => row.event) as MeasurementEvent[],
    voiceEvents: voiceRows as VoiceEventRecord[],
    syncedAt: now(),
  };
}

/* -------------------------------------------------------------------- sample */

async function upsertSample(
  experimentId: string,
  input: Pick<
    RecordMeasurementInput,
    "sampleCode" | "condition" | "organism" | "treatment" | "concentration" | "concentrationUnit"
  >,
): Promise<Sample> {
  const db = getDb();
  const stamp = now();

  await db
    .insert(samples)
    .values({
      id: id(),
      experimentId,
      sampleCode: input.sampleCode,
      condition: input.condition,
      organism: input.organism,
      treatment: input.treatment,
      concentration: input.concentration,
      concentrationUnit: input.concentrationUnit,
      status: "valid",
      statusReason: null,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .onConflictDoNothing();

  const [sample] = await db
    .select()
    .from(samples)
    .where(and(eq(samples.experimentId, experimentId), eq(samples.sampleCode, input.sampleCode)))
    .limit(1);

  if (!sample) throw new LabPilotError("Could not create the sample.", 500, "sample_unavailable");

  // A sample's identity is fixed once it exists. Silently rewriting its
  // condition because a later utterance described it differently would
  // retroactively change what every earlier reading means.
  if (sample.condition !== input.condition) {
    throw new LabPilotError(
      `Sample ${input.sampleCode} is already recorded as "${sample.condition}", not "${input.condition}".`,
      409,
      "sample_conflict",
      { sampleId: sample.id, existingCondition: sample.condition, incomingCondition: input.condition },
    );
  }
  return sample;
}

/* --------------------------------------------------------------- measurement */

export async function recordMeasurement(input: RecordMeasurementInput): Promise<ExperimentSnapshot> {
  await requireExperiment(input.experimentId);
  const db = getDb();

  // Idempotency first: a replayed request must be a no-op, not a second row.
  const [replay] = await db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.experimentId, input.experimentId),
        eq(measurements.requestId, input.requestId),
      ),
    )
    .limit(1);
  if (replay) return getSnapshot(input.experimentId);

  const sample = await upsertSample(input.experimentId, input);

  if (!input.allowDuplicate) {
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();
    const [duplicate] = await db
      .select()
      .from(measurements)
      .where(
        and(
          eq(measurements.sampleId, sample.id),
          eq(measurements.measurementType, input.measurementType),
          eq(measurements.value, input.value),
          gte(measurements.recordedAt, since),
        ),
      )
      .limit(1);

    if (duplicate) {
      throw new LabPilotError(
        `${input.measurementType} ${input.value} was already recorded for sample ${input.sampleCode} moments ago. Confirm to record it again.`,
        409,
        "possible_duplicate",
        { measurementId: duplicate.id, recordedAt: duplicate.recordedAt },
      );
    }
  }

  const stamp = now();
  const measurementId = id();

  await db.batch([
    db.insert(measurements).values({
      id: measurementId,
      experimentId: input.experimentId,
      sampleId: sample.id,
      measurementType: input.measurementType,
      value: input.value,
      unit: input.unit,
      status: "valid",
      exclusionReason: null,
      source: input.source,
      requestId: input.requestId,
      recordedAt: stamp,
      createdAt: stamp,
      updatedAt: stamp,
    }),
    db.insert(measurementEvents).values({
      id: id(),
      measurementId,
      changeType: "recorded",
      previousValue: null,
      revisedValue: input.value,
      previousStatus: null,
      revisedStatus: "valid",
      reason: null,
      source: input.source,
      createdAt: stamp,
    }),
  ]);

  return getSnapshot(input.experimentId);
}

async function requireMeasurement(measurementId: string) {
  await ensureSchema();
  const [row] = await getDb()
    .select()
    .from(measurements)
    .where(eq(measurements.id, measurementId))
    .limit(1);
  if (!row) {
    throw new LabPilotError("That measurement no longer exists.", 404, "measurement_not_found");
  }
  return row;
}

/**
 * Ambiguity resolution that can actually fire.
 *
 * The old check queried by primary key and then asked whether it had matched
 * more than one row — impossible, so the "correction is ambiguous" branch was
 * unreachable. Real ambiguity comes from speech: "actually two percent was
 * point six three" identifies a row by description, and a description can match
 * several readings.
 */
export async function resolveMeasurement(input: ResolveMeasurementInput) {
  const snapshot = await getSnapshot(input.experimentId);
  const candidates = snapshot.measurements.filter((measurement) => {
    if (measurement.effectiveStatus !== "valid") return false;
    if (input.sampleCode && measurement.sampleId !== input.sampleCode) return false;
    if (input.condition && measurement.condition.toLowerCase() !== input.condition.toLowerCase()) {
      return false;
    }
    if (input.measurementType && measurement.measurementType !== input.measurementType) return false;
    return true;
  });

  if (candidates.length === 0) {
    throw new LabPilotError("No measurement matches that description.", 404, "measurement_not_found");
  }
  if (candidates.length > 1) {
    throw new LabPilotError(
      `That matches ${candidates.length} measurements. Which one did you mean?`,
      409,
      "ambiguous_measurement",
      {
        candidates: candidates.map((measurement) => ({
          measurementId: measurement.id,
          sampleId: measurement.sampleId,
          condition: measurement.condition,
          measurementType: measurement.measurementType,
          value: measurement.value,
          recordedAt: measurement.recordedAt,
        })),
      },
    );
  }
  return candidates[0];
}

export async function correctMeasurement(input: CorrectMeasurementInput): Promise<ExperimentSnapshot> {
  const existing = await requireMeasurement(input.measurementId);
  const db = getDb();
  const stamp = now();

  await db.batch([
    db.insert(measurementEvents).values({
      id: id(),
      measurementId: existing.id,
      changeType: "value_corrected",
      previousValue: existing.value,
      revisedValue: input.value,
      previousStatus: existing.status,
      revisedStatus: existing.status,
      reason: input.reason,
      // The real origin of the change. This used to be hardcoded to "manual",
      // so a spoken correction was filed as a human edit forever.
      source: input.source,
      createdAt: stamp,
    }),
    db
      .update(measurements)
      .set({ value: input.value, updatedAt: stamp })
      .where(eq(measurements.id, existing.id)),
  ]);

  return getSnapshot(existing.experimentId);
}

export async function excludeMeasurement(
  measurementId: string,
  reason: string,
  source: RecordMeasurementInput["source"],
): Promise<ExperimentSnapshot> {
  const existing = await requireMeasurement(measurementId);
  const db = getDb();
  const stamp = now();

  await db.batch([
    db.insert(measurementEvents).values({
      id: id(),
      measurementId: existing.id,
      changeType: "excluded",
      previousValue: existing.value,
      revisedValue: existing.value,
      previousStatus: existing.status,
      revisedStatus: "excluded",
      reason,
      source,
      createdAt: stamp,
    }),
    db
      .update(measurements)
      .set({ status: "excluded", exclusionReason: reason, updatedAt: stamp })
      .where(eq(measurements.id, existing.id)),
  ]);

  return getSnapshot(existing.experimentId);
}

export async function restoreMeasurement(input: RestoreMeasurementInput): Promise<ExperimentSnapshot> {
  const existing = await requireMeasurement(input.measurementId);
  const db = getDb();
  const stamp = now();

  await db.batch([
    db.insert(measurementEvents).values({
      id: id(),
      measurementId: existing.id,
      changeType: "restored",
      previousValue: existing.value,
      revisedValue: existing.value,
      previousStatus: existing.status,
      revisedStatus: "valid",
      // Carried into the audit log before it is cleared from the row, so the
      // reason a reading was once excluded survives the restore.
      reason: existing.exclusionReason,
      source: input.source,
      createdAt: stamp,
    }),
    db
      .update(measurements)
      .set({ status: "valid", exclusionReason: null, updatedAt: stamp })
      .where(eq(measurements.id, existing.id)),
  ]);

  return getSnapshot(existing.experimentId);
}

export async function getMeasurementHistory(measurementId: string) {
  await requireMeasurement(measurementId);
  return getDb()
    .select()
    .from(measurementEvents)
    .where(eq(measurementEvents.measurementId, measurementId))
    .orderBy(measurementEvents.createdAt);
}

/* --------------------------------------------------------------- annotations */

/**
 * Contamination is a fact about the tube. Flagging the sample takes all of its
 * readings out of the analysis at once, and leaves the numbers untouched.
 */
export async function annotateSample(input: AnnotateSampleInput): Promise<ExperimentSnapshot> {
  await requireExperiment(input.experimentId);
  const db = getDb();

  const [sample] = await db
    .select()
    .from(samples)
    .where(and(eq(samples.experimentId, input.experimentId), eq(samples.sampleCode, input.sampleCode)))
    .limit(1);

  if (!sample) {
    throw new LabPilotError(
      `Sample ${input.sampleCode} has no recorded measurements yet.`,
      404,
      "sample_not_found",
    );
  }

  const stamp = now();
  const statements: Parameters<typeof db.batch>[0][number][] = [
    db.insert(annotations).values({
      id: id(),
      experimentId: input.experimentId,
      sampleId: sample.id,
      measurementId: null,
      annotationType: input.annotationType,
      content: input.content,
      source: input.source,
      createdAt: stamp,
    }),
  ];

  if (input.excludeFromAnalysis) {
    statements.push(
      db
        .update(samples)
        .set({
          status: input.annotationType === "contamination" ? "contaminated" : "excluded",
          statusReason: input.content,
          updatedAt: stamp,
        })
        .where(eq(samples.id, sample.id)),
    );
  }

  await db.batch(statements as never);
  return getSnapshot(input.experimentId);
}

export async function restoreSample(
  experimentId: string,
  sampleCode: string,
): Promise<ExperimentSnapshot> {
  await requireExperiment(experimentId);
  const db = getDb();
  const result = await db
    .update(samples)
    .set({ status: "valid", statusReason: null, updatedAt: now() })
    .where(and(eq(samples.experimentId, experimentId), eq(samples.sampleCode, sampleCode)))
    .returning({ id: samples.id });

  if (!result.length) {
    throw new LabPilotError(`Sample ${sampleCode} does not exist.`, 404, "sample_not_found");
  }
  return getSnapshot(experimentId);
}

/* -------------------------------------------------------------- voice events */

/**
 * What was said, what it was understood to mean, and whether it worked. The UI
 * used to fabricate this strip client-side from hardcoded strings, so it was
 * lost on refresh and a misheard utterance left no trace to debug.
 */
export async function logVoiceEvent(input: VoiceEventInput) {
  await ensureSchema();
  const row = {
    id: id(),
    experimentId: input.experimentId,
    intent: input.intent,
    rawText: input.rawText,
    parsedPayload: input.parsedPayload,
    toolName: input.toolName,
    success: input.success,
    errorMessage: input.errorMessage,
    createdAt: now(),
  };
  await getDb().insert(voiceEvents).values(row);
  return row;
}

export async function getRecentVoiceEvents(experimentId = DEMO_EXPERIMENT_ID, limit = 20) {
  await ensureSchema();
  return getDb()
    .select()
    .from(voiceEvents)
    .where(eq(voiceEvents.experimentId, experimentId))
    .orderBy(desc(voiceEvents.createdAt))
    .limit(limit);
}

/* ----------------------------------------------------------------- demo seed */

const DEMO_ROWS = [
  { sampleCode: "A", condition: "Control", concentration: 0, treatment: null, value: 0.41 },
  { sampleCode: "B", condition: "1% Inulin", concentration: 1, treatment: "Inulin", value: 0.53 },
  { sampleCode: "C", condition: "2% Inulin", concentration: 2, treatment: "Inulin", value: 0.68 },
];

export async function seedDemoMeasurements(): Promise<ExperimentSnapshot> {
  const experiment = await ensureExperiment();
  const snapshot = await getSnapshot(experiment.id);
  if (snapshot.measurements.length) return snapshot;

  for (const row of DEMO_ROWS) {
    await recordMeasurement({
      experimentId: experiment.id,
      // Stable keys: re-seeding is a no-op instead of a second set of rows.
      requestId: `seed-${experiment.id}-${row.sampleCode}`,
      sampleCode: row.sampleCode,
      condition: row.condition,
      organism: experiment.organism,
      treatment: row.treatment,
      concentration: row.concentration,
      concentrationUnit: "%",
      measurementType: experiment.measurementType,
      value: row.value,
      unit: "OD",
      source: "manual",
      allowDuplicate: false,
    });
  }
  return getSnapshot(experiment.id);
}

export const getMeasurementsForExperiment = () => ensureExperiment().then(() => getSnapshot());

export { env };
