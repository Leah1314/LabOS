import { correctMeasurement, excludeMeasurement, getMeasurementsForExperiment, recordMeasurement, removeMeasurement, restoreMeasurement, seedDemoMeasurements } from "../../../lib/labpilot/server";
import type { RecordMeasurementInput } from "../../../lib/labpilot/types";
import { env } from "cloudflare:workers";

export const GET = (request: Request) => {
  const denied = authorize(request);
  return denied ?? getMeasurementsForExperiment().then(Response.json).catch(errorResponse);
};

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { action?: string; input?: RecordMeasurementInput; measurementId?: string; value?: number; reason?: string };
    if (body.action === "record" && body.input) return Response.json(await recordMeasurement(body.input), { status: 201 });
    if (body.action === "correct" && body.measurementId && typeof body.value === "number") return Response.json(await correctMeasurement(body.measurementId, body.value));
    if (body.action === "exclude" && body.measurementId && body.reason) return Response.json(await excludeMeasurement(body.measurementId, body.reason));
    if (body.action === "restore" && body.measurementId) return Response.json(await restoreMeasurement(body.measurementId));
    if (body.action === "remove" && body.measurementId) return Response.json(await removeMeasurement(body.measurementId));
    if (body.action === "seed") return Response.json(await seedDemoMeasurements());
    return Response.json({ error: "Unsupported or incomplete action." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

function authorize(request: Request) {
  // Private Sites requests carry the signed-in user's identity. VoiceOS uses
  // a separate bearer token supplied through a password preference.
  if (request.headers.get("oai-authenticated-user-email")) return null;
  const configured = (env as typeof env & { LABPILOT_INTEGRATION_TOKEN?: string }).LABPILOT_INTEGRATION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (configured && supplied === configured) return null;
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

function errorResponse(error: unknown) {
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected LabPilot error." }, { status: 400 });
}
