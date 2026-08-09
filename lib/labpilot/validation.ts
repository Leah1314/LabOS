/**
 * Runtime validation for everything that crosses the API boundary.
 *
 * The previous build validated nothing at run time: `types.ts` held TypeScript
 * interfaces, which vanish at compile time, and the route handler spread the
 * raw request body straight into the insert. That let a caller choose its own
 * `source`, so a voice-recorded value could be stored as `manual` and the
 * provenance trail would quietly lie.
 *
 * Deliberately dependency-free. These checks are domain checks — normalising a
 * spoken sample code, bounding a measurement — not shape checks, so a schema
 * library would sit underneath them rather than replace them. Swapping the
 * primitives below for Zod is mechanical if the team wants it later.
 */

export type Issue = { field: string; message: string };
export type Validated<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

export const SOURCES = ["manual", "voice", "api"] as const;
export type Source = (typeof SOURCES)[number];

const LIMITS = {
  code: 32,
  label: 64,
  reason: 500,
  text: 2000,
  requestId: 64,
  value: 1e6,
  concentration: 1e6,
};

/** Spoken text arrives with stray spacing far more often than typed text does. */
const collapse = (raw: string) => raw.trim().replace(/\s+/g, " ");

function text(
  field: string,
  raw: unknown,
  { max, required = true }: { max: number; required?: boolean },
): Validated<string | null> {
  if (raw === undefined || raw === null || raw === "") {
    if (required) return { ok: false, issues: [{ field, message: `${field} is required.` }] };
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, issues: [{ field, message: `${field} must be text.` }] };
  }
  const value = collapse(raw);
  if (!value && required) {
    return { ok: false, issues: [{ field, message: `${field} cannot be blank.` }] };
  }
  if (value.length > max) {
    return { ok: false, issues: [{ field, message: `${field} must be ${max} characters or fewer.` }] };
  }
  return { ok: true, value: value || null };
}

function num(
  field: string,
  raw: unknown,
  { min, max, required = true }: { min: number; max: number; required?: boolean },
): Validated<number | null> {
  if (raw === undefined || raw === null || raw === "") {
    if (required) return { ok: false, issues: [{ field, message: `${field} is required.` }] };
    return { ok: true, value: null };
  }
  // Note: `typeof NaN === "number"`, which is exactly how a bad transcription
  // used to reach the concentration column unchallenged.
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, issues: [{ field, message: `${field} must be a finite number.` }] };
  }
  if (raw < min || raw > max) {
    return { ok: false, issues: [{ field, message: `${field} must be between ${min} and ${max}.` }] };
  }
  return { ok: true, value: raw };
}

function oneOf<T extends string>(
  field: string,
  raw: unknown,
  allowed: readonly T[],
): Validated<T> {
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    return { ok: false, issues: [{ field, message: `${field} must be one of: ${allowed.join(", ")}.` }] };
  }
  return { ok: true, value: raw as T };
}

/** Collects every issue instead of failing on the first — a voice UI should be able to say everything that is wrong in one breath. */
class Collector {
  readonly issues: Issue[] = [];

  take<T>(result: Validated<T>): T | null {
    if (result.ok) return result.value;
    this.issues.push(...result.issues);
    return null;
  }

  finish<T>(build: () => T): Validated<T> {
    if (this.issues.length) return { ok: false, issues: this.issues };
    return { ok: true, value: build() };
  }
}

/* --------------------------------------------------------------- normalisers */

/** "sample b " and "Sample  B" are the same tube. Without this they were two. */
export const normalizeSampleCode = (raw: string) =>
  collapse(raw).replace(/^sample\s+/i, "").toUpperCase();

/* ------------------------------------------------------------------ payloads */

export interface StartExperimentInput {
  experimentCode: string;
  title: string;
  organism: string;
  treatmentVariable: string;
  measurementType: string;
  source: Source;
}

export function parseStartExperiment(raw: unknown): Validated<StartExperimentInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const experimentCode = c.take(text("experimentCode", body.experimentCode, { max: LIMITS.code }));
  const title = c.take(text("title", body.title, { max: LIMITS.label * 4 }));
  const organism = c.take(text("organism", body.organism, { max: LIMITS.label }));
  const treatmentVariable = c.take(text("treatmentVariable", body.treatmentVariable, { max: LIMITS.label }));
  const measurementType = c.take(text("measurementType", body.measurementType, { max: LIMITS.code }));
  const source = c.take(oneOf("source", body.source, SOURCES));

  return c.finish(() => ({
    experimentCode: experimentCode!.toUpperCase(),
    title: title!,
    organism: organism!,
    treatmentVariable: treatmentVariable!,
    measurementType: measurementType!.toUpperCase(),
    source: source!,
  }));
}

export interface RecordMeasurementInput {
  experimentId: string;
  requestId: string;
  sampleCode: string;
  condition: string;
  organism: string;
  treatment: string | null;
  concentration: number | null;
  concentrationUnit: string | null;
  measurementType: string;
  value: number;
  unit: string | null;
  source: Source;
  allowDuplicate: boolean;
}

export function parseRecordMeasurement(raw: unknown): Validated<RecordMeasurementInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();

  const experimentId = c.take(text("experimentId", body.experimentId, { max: LIMITS.code * 2 }));
  const requestId = c.take(text("requestId", body.requestId, { max: LIMITS.requestId }));
  const rawSample = c.take(text("sampleCode", body.sampleCode ?? body.sampleId, { max: LIMITS.code }));
  const condition = c.take(text("condition", body.condition, { max: LIMITS.label }));
  const organism = c.take(text("organism", body.organism, { max: LIMITS.label }));
  const treatment = c.take(text("treatment", body.treatment, { max: LIMITS.label, required: false }));
  const concentration = c.take(
    num("concentration", body.concentration, { min: 0, max: LIMITS.concentration, required: false }),
  );
  const concentrationUnit = c.take(
    text("concentrationUnit", body.concentrationUnit, { max: LIMITS.code, required: false }),
  );
  const measurementType = c.take(text("measurementType", body.measurementType, { max: LIMITS.code }));
  const value = c.take(num("value", body.value, { min: 0, max: LIMITS.value }));
  const unit = c.take(text("unit", body.unit, { max: LIMITS.code, required: false }));
  const source = c.take(oneOf("source", body.source ?? body.inputSource, SOURCES));

  if (concentration !== null && concentrationUnit === null && c.issues.length === 0) {
    c.issues.push({
      field: "concentrationUnit",
      message: "A concentration without a unit is not a scientific quantity.",
    });
  }

  return c.finish(() => ({
    experimentId: experimentId!,
    requestId: requestId!,
    sampleCode: normalizeSampleCode(rawSample!),
    condition: condition!,
    organism: organism!,
    treatment,
    concentration,
    concentrationUnit,
    measurementType: measurementType!.toUpperCase(),
    value: value!,
    unit,
    source: source!,
    allowDuplicate: body.allowDuplicate === true,
  }));
}

export interface CorrectMeasurementInput {
  measurementId: string;
  value: number;
  source: Source;
  reason: string | null;
}

export function parseCorrectMeasurement(raw: unknown): Validated<CorrectMeasurementInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const measurementId = c.take(text("measurementId", body.measurementId, { max: LIMITS.code * 2 }));
  const value = c.take(num("value", body.value, { min: 0, max: LIMITS.value }));
  const source = c.take(oneOf("source", body.source, SOURCES));
  const reason = c.take(text("reason", body.reason, { max: LIMITS.reason, required: false }));
  return c.finish(() => ({ measurementId: measurementId!, value: value!, source: source!, reason }));
}

export interface ResolveMeasurementInput {
  experimentId: string;
  sampleCode: string | null;
  condition: string | null;
  measurementType: string | null;
}

/** Resolving "actually two percent was point six three" to a row, by description rather than by id. */
export function parseResolveMeasurement(raw: unknown): Validated<ResolveMeasurementInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const experimentId = c.take(text("experimentId", body.experimentId, { max: LIMITS.code * 2 }));
  const sampleCode = c.take(text("sampleCode", body.sampleCode, { max: LIMITS.code, required: false }));
  const condition = c.take(text("condition", body.condition, { max: LIMITS.label, required: false }));
  const measurementType = c.take(
    text("measurementType", body.measurementType, { max: LIMITS.code, required: false }),
  );

  if (!sampleCode && !condition && c.issues.length === 0) {
    c.issues.push({
      field: "sampleCode",
      message: "Give at least a sample code or a condition to identify the measurement.",
    });
  }

  return c.finish(() => ({
    experimentId: experimentId!,
    sampleCode: sampleCode ? normalizeSampleCode(sampleCode) : null,
    condition,
    measurementType: measurementType ? measurementType.toUpperCase() : null,
  }));
}

export interface AnnotateSampleInput {
  experimentId: string;
  sampleCode: string;
  annotationType: "contamination" | "note" | "flag";
  content: string;
  excludeFromAnalysis: boolean;
  source: Source;
}

export function parseAnnotateSample(raw: unknown): Validated<AnnotateSampleInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const experimentId = c.take(text("experimentId", body.experimentId, { max: LIMITS.code * 2 }));
  const sampleCode = c.take(text("sampleCode", body.sampleCode, { max: LIMITS.code }));
  const annotationType = c.take(
    oneOf("annotationType", body.annotationType, ["contamination", "note", "flag"] as const),
  );
  const content = c.take(text("content", body.content, { max: LIMITS.text }));
  const source = c.take(oneOf("source", body.source, SOURCES));
  return c.finish(() => ({
    experimentId: experimentId!,
    sampleCode: normalizeSampleCode(sampleCode!),
    annotationType: annotationType!,
    content: content!,
    excludeFromAnalysis: body.excludeFromAnalysis === true,
    source: source!,
  }));
}

export interface RestoreMeasurementInput {
  measurementId: string;
  source: Source;
}

export function parseRestoreMeasurement(raw: unknown): Validated<RestoreMeasurementInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const measurementId = c.take(text("measurementId", body.measurementId, { max: LIMITS.code * 2 }));
  const source = c.take(oneOf("source", body.source, SOURCES));
  return c.finish(() => ({ measurementId: measurementId!, source: source! }));
}

export interface VoiceEventInput {
  experimentId: string | null;
  intent: string;
  rawText: string;
  parsedPayload: string | null;
  toolName: string | null;
  success: boolean;
  errorMessage: string | null;
}

export function parseVoiceEvent(raw: unknown): Validated<VoiceEventInput> {
  const body = (raw ?? {}) as Record<string, unknown>;
  const c = new Collector();
  const experimentId = c.take(
    text("experimentId", body.experimentId, { max: LIMITS.code * 2, required: false }),
  );
  const intent = c.take(text("intent", body.intent, { max: LIMITS.code * 2 }));
  const rawText = c.take(text("rawText", body.rawText, { max: LIMITS.text }));
  const toolName = c.take(text("toolName", body.toolName, { max: LIMITS.code * 2, required: false }));
  const errorMessage = c.take(
    text("errorMessage", body.errorMessage, { max: LIMITS.reason, required: false }),
  );

  let parsedPayload: string | null = null;
  if (body.parsedPayload !== undefined && body.parsedPayload !== null) {
    try {
      parsedPayload = JSON.stringify(body.parsedPayload).slice(0, LIMITS.text);
    } catch {
      c.issues.push({ field: "parsedPayload", message: "parsedPayload must be JSON-serialisable." });
    }
  }

  return c.finish(() => ({
    experimentId,
    intent: intent!,
    rawText: rawText!,
    parsedPayload,
    toolName,
    success: body.success !== false,
    errorMessage,
  }));
}
