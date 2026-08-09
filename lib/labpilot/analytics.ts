import type { ConditionSummary, MeasurementView } from "./types";

/**
 * Deterministic analysis over measurements.
 *
 * The previous implementation compared individual readings and returned the
 * single largest row, so "which condition performed best?" was answered by one
 * lucky replicate rather than by the condition. With replicates — which is the
 * normal case in a wet lab — it gave the wrong answer. Everything here groups
 * by condition first.
 */

/**
 * Excludes readings whose sample is contaminated as well as readings excluded
 * individually. Tests `=== "valid"` rather than `!== "excluded"` so that adding
 * a future status cannot silently enrol it into the analysis set.
 */
export function getValidMeasurements(measurements: MeasurementView[]) {
  return measurements.filter((measurement) => measurement.effectiveStatus === "valid");
}

/**
 * Conditions are only comparable within one measurement type: you cannot rank
 * an OD600 against a pH.
 */
export function summarizeByCondition(measurements: MeasurementView[]): ConditionSummary[] {
  const groups = new Map<string, { condition: string; measurementType: string; values: number[] }>();

  for (const measurement of getValidMeasurements(measurements)) {
    // Encoded rather than concatenated: any plain separator can also occur
    // inside a condition name, and "OD" + "600X" must not collide with
    // "OD600" + "X".
    const key = JSON.stringify([measurement.measurementType, measurement.condition]);
    let group = groups.get(key);
    if (!group) {
      group = {
        condition: measurement.condition,
        measurementType: measurement.measurementType,
        values: [],
      };
      groups.set(key, group);
    }
    group.values.push(measurement.value);
  }

  return [...groups.values()]
    .map(({ condition, measurementType, values }) => ({
      condition,
      measurementType,
      n: values.length,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
    }))
    .sort((a, b) =>
      a.measurementType === b.measurementType
        ? b.mean - a.mean
        : a.measurementType.localeCompare(b.measurementType),
    );
}

/**
 * `direction` is explicit because "best" is not a property of the data. For
 * OD600 more growth is better; for a pH drift or an inhibition score it is not.
 * Ties are reported rather than broken silently — a tie is a real result.
 */
export function getBestCondition(
  measurements: MeasurementView[],
  options: { measurementType?: string; direction?: "higher" | "lower" } = {},
): { best: ConditionSummary; tiedWith: ConditionSummary[] } | null {
  const direction = options.direction ?? "higher";
  const summaries = summarizeByCondition(measurements).filter(
    (summary) => !options.measurementType || summary.measurementType === options.measurementType,
  );
  if (!summaries.length) return null;

  const types = new Set(summaries.map((summary) => summary.measurementType));
  const scoped =
    types.size > 1
      ? summaries.filter((summary) => summary.measurementType === summaries[0].measurementType)
      : summaries;

  const best = scoped.reduce((winner, summary) =>
    direction === "higher"
      ? summary.mean > winner.mean
        ? summary
        : winner
      : summary.mean < winner.mean
        ? summary
        : winner,
  );

  const tiedWith = scoped.filter(
    (summary) => summary !== best && Math.abs(summary.mean - best.mean) < Number.EPSILON * 8,
  );

  return { best, tiedWith };
}

export function getAverageMeasurement(measurements: MeasurementView[]) {
  const valid = getValidMeasurements(measurements);
  if (!valid.length) return null;
  return valid.reduce((sum, measurement) => sum + measurement.value, 0) / valid.length;
}
