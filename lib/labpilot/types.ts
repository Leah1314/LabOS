export type ExperimentStatus = "draft" | "running" | "completed";
export type MeasurementStatus = "valid" | "excluded";
export type SampleStatus = "valid" | "contaminated" | "excluded";
export type Source = "manual" | "voice" | "api";
export type ChangeType = "recorded" | "value_corrected" | "excluded" | "restored";

export interface Experiment {
  id: string;
  experimentCode: string;
  title: string;
  organism: string;
  treatmentVariable: string;
  measurementType: string;
  status: ExperimentStatus;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sample {
  id: string;
  experimentId: string;
  sampleCode: string;
  condition: string;
  organism: string;
  treatment: string | null;
  concentration: number | null;
  concentrationUnit: string | null;
  status: SampleStatus;
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A measurement joined to its sample, which is what every consumer actually
 * wants. `sampleId` stays the human-readable code ("B") the researcher speaks;
 * `sampleRowId` is the foreign key.
 */
export interface MeasurementView {
  id: string;
  experimentId: string;
  sampleId: string;
  sampleRowId: string;
  condition: string;
  organism: string;
  treatment: string | null;
  concentration: number | null;
  concentrationUnit: string | null;
  measurementType: string;
  value: number;
  unit: string | null;
  status: MeasurementStatus;
  exclusionReason: string | null;
  sampleStatus: SampleStatus;
  /**
   * `valid` only when the reading *and* its sample are both usable. Excluding a
   * contaminated sample has to remove its readings from analysis without
   * rewriting them — the numbers stay, they just stop counting.
   */
  effectiveStatus: MeasurementStatus;
  source: Source;
  requestId: string;
  recordedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeasurementEvent {
  id: string;
  measurementId: string;
  changeType: ChangeType;
  previousValue: number | null;
  revisedValue: number | null;
  previousStatus: string | null;
  revisedStatus: string | null;
  reason: string | null;
  source: Source;
  createdAt: string;
}

export interface Annotation {
  id: string;
  experimentId: string;
  sampleId: string | null;
  measurementId: string | null;
  annotationType: "contamination" | "note" | "flag";
  content: string;
  source: Source;
  createdAt: string;
}

/** One row per condition, which is the unit a researcher actually compares. */
export interface ConditionSummary {
  condition: string;
  measurementType: string;
  mean: number;
  n: number;
  min: number;
  max: number;
}

export interface VoiceEventRecord {
  id: string;
  experimentId: string | null;
  intent: string;
  rawText: string;
  parsedPayload: string | null;
  toolName: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
}

export interface ExperimentSnapshot {
  experiment: Experiment;
  samples: Sample[];
  measurements: MeasurementView[];
  annotations: Annotation[];
  summary: ConditionSummary[];
  /** Newest first, bounded. Feeds the per-row audit trail. */
  events: MeasurementEvent[];
  /**
   * Newest first, bounded. The activity strip reads real rows from here
   * instead of the hardcoded strings the dashboard used to fabricate.
   */
  voiceEvents: VoiceEventRecord[];
  syncedAt: string;
}

export interface ActivityEvent {
  captured: string;
  structured: string;
  changed: string;
  timestamp: string;
}
