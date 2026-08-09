export type ExperimentStatus = "draft" | "running" | "completed";
export type MeasurementStatus = "valid" | "excluded";
export type InputSource = "manual" | "voice" | "api";

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
}

export interface Measurement {
  id: string;
  experimentId: string;
  sampleId: string;
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
  inputSource: InputSource;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEvent {
  captured: string;
  structured: string;
  changed: string;
  timestamp: string;
}

export interface ExperimentSnapshot {
  experiment: Experiment;
  measurements: Measurement[];
}

export interface RecordMeasurementInput {
  experimentId: string;
  sampleId: string;
  condition: string;
  organism: string;
  treatment?: string | null;
  concentration?: number | null;
  concentrationUnit?: string | null;
  measurementType: string;
  value: number;
  unit?: string | null;
  inputSource: InputSource;
}
