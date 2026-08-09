import type { ExperimentSnapshot, RecordMeasurementInput } from "./types";

async function request<T>(body?: unknown): Promise<T> {
  const response = await fetch("/api/experiment", {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "LabPilot request failed");
  return payload;
}

export const getExperiment = () => request<ExperimentSnapshot>();
export const recordMeasurement = (input: RecordMeasurementInput) =>
  request<ExperimentSnapshot>({ action: "record", input });
export const correctMeasurement = (measurementId: string, value: number) =>
  request<ExperimentSnapshot>({ action: "correct", measurementId, value });
export const excludeMeasurement = (measurementId: string, reason: string) =>
  request<ExperimentSnapshot>({ action: "exclude", measurementId, reason });
export const restoreMeasurement = (measurementId: string) =>
  request<ExperimentSnapshot>({ action: "restore", measurementId });
export const seedDemo = () => request<ExperimentSnapshot>({ action: "seed" });
