import { correctMeasurement, excludeMeasurement, getMeasurementsForExperiment, recordMeasurement, restoreMeasurement, seedDemoMeasurements } from "../../../lib/labpilot/server";
import type { RecordMeasurementInput } from "../../../lib/labpilot/types";

export const GET = () => getMeasurementsForExperiment().then(Response.json).catch(errorResponse);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: string; input?: RecordMeasurementInput; measurementId?: string; value?: number; reason?: string };
    if (body.action === "record" && body.input) return Response.json(await recordMeasurement(body.input), { status: 201 });
    if (body.action === "correct" && body.measurementId && typeof body.value === "number") return Response.json(await correctMeasurement(body.measurementId, body.value));
    if (body.action === "exclude" && body.measurementId && body.reason) return Response.json(await excludeMeasurement(body.measurementId, body.reason));
    if (body.action === "restore" && body.measurementId) return Response.json(await restoreMeasurement(body.measurementId));
    if (body.action === "seed") return Response.json(await seedDemoMeasurements());
    return Response.json({ error: "Unsupported or incomplete action." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected LabPilot error." }, { status: 400 });
}
