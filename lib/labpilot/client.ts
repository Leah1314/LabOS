import type { ExperimentSnapshot, MeasurementView, Source } from "./types";

/** Structured so callers can react to a conflict instead of only showing text. */
export class LabPilotRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LabPilotRequestError";
  }
}

async function request<T>(body?: unknown, query = ""): Promise<T> {
  const response = await fetch(`/api/experiment${query}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string; code?: string; details?: unknown };
  if (!response.ok) {
    throw new LabPilotRequestError(
      payload.error ?? "LabPilot request failed",
      response.status,
      payload.code ?? "unknown_error",
      payload.details,
    );
  }
  return payload;
}

export interface RecordMeasurementRequest {
  experimentId: string;
  sampleCode: string;
  condition: string;
  organism: string;
  measurementType: string;
  value: number;
  treatment?: string | null;
  concentration?: number | null;
  concentrationUnit?: string | null;
  unit?: string | null;
  source?: Source;
  /** Reuse to retry safely; omit and one is generated per call. */
  requestId?: string;
  allowDuplicate?: boolean;
}

export const getExperiment = (experimentId?: string) =>
  request<ExperimentSnapshot>(undefined, experimentId ? `?experimentId=${encodeURIComponent(experimentId)}` : "");

export const recordMeasurement = (input: RecordMeasurementRequest) =>
  request<ExperimentSnapshot>({
    action: "record",
    input: {
      source: "manual" as Source,
      requestId: crypto.randomUUID(),
      allowDuplicate: false,
      ...input,
    },
  });

export const correctMeasurement = (measurementId: string, value: number, source: Source = "manual", reason?: string) =>
  request<ExperimentSnapshot>({ action: "correct", input: { measurementId, value, source, reason } });

export const excludeMeasurement = (measurementId: string, reason: string, source: Source = "manual") =>
  request<ExperimentSnapshot>({ action: "exclude", input: { measurementId, source }, reason });

export const restoreMeasurement = (measurementId: string, source: Source = "manual") =>
  request<ExperimentSnapshot>({ action: "restore", input: { measurementId, source } });

export const annotateSample = (input: {
  experimentId: string;
  sampleCode: string;
  annotationType: "contamination" | "note" | "flag";
  content: string;
  excludeFromAnalysis?: boolean;
  source?: Source;
}) => request<ExperimentSnapshot>({ action: "annotate", input: { source: "manual" as Source, ...input } });

export const restoreSample = (experimentId: string, sampleCode: string) =>
  request<ExperimentSnapshot>({ action: "restore_sample", experimentId, sampleCode });

/** Find the row behind "actually two percent was point six three". */
export const resolveMeasurement = (input: {
  experimentId: string;
  sampleCode?: string;
  condition?: string;
  measurementType?: string;
}) => request<{ measurement: MeasurementView }>({ action: "resolve", input });

export const seedDemo = () => request<ExperimentSnapshot>({ action: "seed" });

/** What was said, what it was understood to mean, and whether it worked. */
export const logVoiceEvent = (input: {
  experimentId?: string | null;
  intent: string;
  rawText: string;
  parsedPayload?: unknown;
  toolName?: string | null;
  success?: boolean;
  errorMessage?: string | null;
}) => request<{ id: string }>({ action: "voice_event", input });
