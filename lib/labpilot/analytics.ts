import type { Measurement } from "./types";

export function getValidMeasurements(measurements: Measurement[]) {
  return measurements.filter((measurement) => measurement.status !== "excluded");
}

export function getBestCondition(measurements: Measurement[]) {
  const valid = getValidMeasurements(measurements);
  return valid.reduce<Measurement | null>(
    (best, measurement) => (!best || measurement.value > best.value ? measurement : best),
    null,
  );
}

export function getAverageMeasurement(measurements: Measurement[]) {
  const valid = getValidMeasurements(measurements);
  if (!valid.length) return null;
  return valid.reduce((sum, measurement) => sum + measurement.value, 0) / valid.length;
}
