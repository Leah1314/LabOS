import {
  LabPilotError,
  annotateSample,
  correctMeasurement,
  excludeMeasurement,
  getMeasurementHistory,
  getRecentVoiceEvents,
  getSnapshot,
  logVoiceEvent,
  recordMeasurement,
  resolveMeasurement,
  restoreMeasurement,
  restoreSample,
  seedDemoMeasurements,
  startExperiment,
} from "../../../lib/labpilot/server";
import {
  parseAnnotateSample,
  parseCorrectMeasurement,
  parseRecordMeasurement,
  parseResolveMeasurement,
  parseRestoreMeasurement,
  parseStartExperiment,
  parseVoiceEvent,
  type Validated,
} from "../../../lib/labpilot/validation";

/**
 * Every write is validated at run time before it reaches the database, and
 * failures are reported with a status code that says what went wrong. The
 * previous handler spread the request body straight into the insert and
 * answered every failure — missing row, bad input, database unavailable — with
 * a 400 carrying the raw internal error message.
 */

/**
 * `force-dynamic` plus `no-store` on every response: the dashboard polls this
 * route once a second, and a cached snapshot is a dashboard that quietly lies.
 */
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0" } });

function fail(error: unknown) {
  if (error instanceof LabPilotError) {
    return json({ error: error.message, code: error.code, details: error.details }, error.status);
  }
  // Internal failures must not leak infrastructure detail to the client.
  console.error("labpilot:unhandled", error);
  return json({ error: "LabPilot could not complete that request.", code: "internal_error" }, 500);
}

/** 422 with every issue at once, so a voice UI can read back all of them in one turn. */
function unwrap<T>(result: Validated<T>): T {
  if (!result.ok) {
    throw new LabPilotError("That request is not valid.", 422, "invalid_input", {
      issues: result.issues,
    });
  }
  return result.value;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const experimentId = url.searchParams.get("experimentId") ?? undefined;

    if (url.searchParams.get("view") === "history") {
      const measurementId = url.searchParams.get("measurementId");
      if (!measurementId) {
        throw new LabPilotError("measurementId is required.", 422, "invalid_input");
      }
      return json({ events: await getMeasurementHistory(measurementId) });
    }

    if (url.searchParams.get("view") === "voice") {
      return json({ events: await getRecentVoiceEvents(experimentId) });
    }

    return json(await getSnapshot(experimentId));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new LabPilotError("Request body must be JSON.", 400, "invalid_body");
    }

    switch (body.action) {
      case "start":
        return json(await startExperiment(unwrap(parseStartExperiment(body.input))), 201);

      case "record":
        return json(await recordMeasurement(unwrap(parseRecordMeasurement(body.input))), 201);

      case "resolve":
        return json({ measurement: await resolveMeasurement(unwrap(parseResolveMeasurement(body.input))) });

      case "correct":
        return json(await correctMeasurement(unwrap(parseCorrectMeasurement(body.input ?? body))));

      case "exclude": {
        const input = unwrap(parseCorrectMeasurement({ ...(body.input ?? body), value: 0 }));
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) throw new LabPilotError("An exclusion reason is required.", 422, "invalid_input");
        return json(await excludeMeasurement(input.measurementId, reason, input.source));
      }

      case "restore":
        return json(await restoreMeasurement(unwrap(parseRestoreMeasurement(body.input ?? body))));

      case "annotate":
        return json(await annotateSample(unwrap(parseAnnotateSample(body.input))), 201);

      case "restore_sample": {
        const experimentId = typeof body.experimentId === "string" ? body.experimentId : "";
        const sampleCode = typeof body.sampleCode === "string" ? body.sampleCode : "";
        if (!experimentId || !sampleCode) {
          throw new LabPilotError("experimentId and sampleCode are required.", 422, "invalid_input");
        }
        return json(await restoreSample(experimentId, sampleCode.trim().toUpperCase()));
      }

      case "voice_event":
        return json(await logVoiceEvent(unwrap(parseVoiceEvent(body.input))), 201);

      case "seed":
        return json(await seedDemoMeasurements());

      default:
        return json({ error: `Unknown action: ${String(body.action)}`, code: "unknown_action" }, 400);
    }
  } catch (error) {
    return fail(error);
  }
}
