#!/usr/bin/env node
/**
 * LabPilot Voice — VoiceOS MCP integration (stdio).
 *
 * Hand-rolled JSON-RPC because `@voiceos/integration-sdk` is not on the public
 * registry during developer preview. MCP over stdio is newline-delimited
 * JSON-RPC 2.0: initialize / tools/list / tools/call / ping.
 *
 * tools/list is generated from voiceos.integration.json so the manifest and the
 * wire protocol cannot drift apart.
 *
 * Everything here is a thin, honest client of the LabPilot API. Validation,
 * idempotency, the audit log and the analytics all live behind that API — this
 * process must never become a second place where scientific rules are decided.
 */
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glanceResult, toolResult } from "./glance.mjs";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "voiceos.integration.json"), "utf8"),
);

const BASE_URL = (process.env.LABPILOT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const EXPERIMENT_ID = process.env.LABPILOT_EXPERIMENT_ID || "exp-042";
const FETCH_TIMEOUT_MS = 8000;

const TOOLS = MANIFEST.tools.map(({ name, title, description, inputSchema }) => ({
  name,
  title,
  description,
  inputSchema,
  annotations: { readOnlyHint: name === "query_experiment", destructiveHint: false },
}));

/* ------------------------------------------------------------------- client */

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `LabPilot returned ${status}`);
    this.status = status;
    this.code = body?.code || "unknown_error";
    this.details = body?.details;
  }
}

async function api(path, init) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ApiError(0, {
      error: `LabPilot is not reachable at ${BASE_URL}. Is the dashboard running?`,
      code: "unreachable",
      details: { cause: String(error?.message || error) },
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

const post = (action, payload) =>
  api("/api/experiment", { method: "POST", body: JSON.stringify({ action, ...payload }) });

const snapshot = () => api(`/api/experiment?experimentId=${encodeURIComponent(EXPERIMENT_ID)}`);

/**
 * The dashboard's activity strip reads this table, so every spoken turn shows
 * up on screen as "what was said / what it became / whether it worked" — even
 * when the turn failed. Logging must never be able to break the tool itself.
 */
async function logVoice(intent, rawText, extra = {}) {
  try {
    await post("voice_event", {
      input: {
        experimentId: EXPERIMENT_ID,
        intent,
        rawText,
        toolName: intent,
        success: extra.success !== false,
        errorMessage: extra.errorMessage ?? null,
        parsedPayload: extra.payload ?? null,
      },
    });
  } catch {
    /* the observation matters more than its log line */
  }
}

/* -------------------------------------------------------------------- utils */

const num = (raw) => {
  const value = typeof raw === "string" ? Number(raw.trim()) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const text = (raw) => (typeof raw === "string" && raw.trim() ? raw.trim() : null);

/**
 * Deterministic idempotency key.
 *
 * A retried tool call inside the same minute reuses the key and is a no-op
 * rather than a second row; the same reading taken a minute later is a genuine
 * replicate and gets its own. Confirmed duplicates opt out explicitly.
 */
function requestKey(parts, unique = false) {
  const minute = Math.floor(Date.now() / 60000);
  const base = `voice:${parts.join(":")}:${minute}`.replace(/\s+/g, "_");
  return (unique ? `${base}:${Math.floor(Date.now() % 100000)}` : base).slice(0, 64);
}

const spokenError = (error) =>
  toolResult(
    {
      error: error.code,
      message: error.message,
      details: error.details,
      narrationHint: error.message,
      ...glanceResult([
        { type: "header", title: "没有写入", icon: "warning" },
        { type: "badges", items: [{ text: error.code, tone: "bad" }] },
      ]),
    },
    { isError: true },
  );

/* -------------------------------------------------------------------- tools */

async function recordMeasurement(args) {
  const sampleCode = text(args.sample_code);
  const condition = text(args.condition);
  const value = num(args.value);
  if (!sampleCode || !condition || value === null) {
    return spokenError(
      new ApiError(422, { error: "需要样本、条件和数值三样才能记录。", code: "invalid_input" }),
    );
  }

  const current = await snapshot().catch(() => null);
  const measurementType = text(args.measurement_type) || current?.experiment?.measurementType || "OD600";
  const allowDuplicate = args.allow_duplicate === true;

  const input = {
    experimentId: EXPERIMENT_ID,
    requestId: requestKey([sampleCode, measurementType, value], allowDuplicate),
    sampleCode,
    condition,
    organism: current?.experiment?.organism ?? "Unknown",
    treatment: text(args.treatment),
    concentration: num(args.concentration),
    concentrationUnit: text(args.concentration_unit),
    measurementType,
    value,
    unit: text(args.unit),
    source: "voice",
    allowDuplicate,
  };

  let result;
  try {
    result = await post("record", { input });
  } catch (error) {
    await logVoice("record_measurement", `${sampleCode} ${condition} ${measurementType} ${value}`, {
      success: false,
      errorMessage: error.message,
    });
    if (error.code === "possible_duplicate") {
      return toolResult({
        error: "possible_duplicate",
        message: error.message,
        // The researcher decides whether this is a replicate. The system does
        // not get to guess, and does not get to silently drop it either.
        narrationHint: `${error.message} 这是真的又测了一次吗？`,
        nextStep: "确认这是一次真实的重复读数，就再说一次并加上「确认重复」。",
        ...glanceResult([
          { type: "header", title: "疑似重复读数", icon: "warning" },
          { type: "list", rows: [{ title: `${sampleCode} · ${measurementType} ${value}`, subtitle: error.message }] },
          { type: "badges", items: [{ text: "等待确认", tone: "bad" }] },
        ]),
      });
    }
    return spokenError(error);
  }

  const row = result.measurements.find((m) => m.requestId === input.requestId);
  await logVoice("record_measurement", `${sampleCode}, ${condition}, ${measurementType} ${value}`, {
    payload: { sampleCode, condition, measurementType, value },
  });

  return toolResult({
    recorded: row ?? null,
    totals: { valid: result.measurements.filter((m) => m.effectiveStatus === "valid").length, all: result.measurements.length },
    summary: result.summary,
    narrationHint: `记下了：样本 ${sampleCode}，${condition}，${measurementType} ${value}。来源标为语音。`,
    ...glanceResult([
      { type: "header", title: `${condition} · ${measurementType}`, icon: "sparkle", trailing: String(value) },
      {
        type: "list",
        rows: result.summary.slice(0, 6).map((entry) => ({
          title: entry.condition,
          subtitle: `n=${entry.n}`,
          trailing: entry.mean.toFixed(2),
        })),
      },
      { type: "badges", items: [{ text: "已写入 · 来源 voice", tone: "good" }] },
    ]),
  });
}

async function correctMeasurement(args) {
  const value = num(args.value);
  if (value === null) {
    return spokenError(new ApiError(422, { error: "修正需要一个数值。", code: "invalid_input" }));
  }

  let measurementId = text(args.measurement_id);
  const spoken = `${text(args.condition) ?? text(args.sample_code) ?? ""} → ${value}`;

  if (!measurementId) {
    try {
      const resolved = await post("resolve", {
        input: {
          experimentId: EXPERIMENT_ID,
          sampleCode: text(args.sample_code),
          condition: text(args.condition),
          measurementType: text(args.measurement_type),
        },
      });
      measurementId = resolved.measurement.id;
    } catch (error) {
      await logVoice("correct_measurement", spoken, { success: false, errorMessage: error.message });
      if (error.code === "ambiguous_measurement") {
        const candidates = error.details?.candidates ?? [];
        // Asking is the correct outcome here, not a failure to be smoothed over.
        return toolResult({
          error: "ambiguous_measurement",
          message: error.message,
          candidates,
          narrationHint: `这个描述对上了 ${candidates.length} 条测量，你指的是哪一条？`,
          ...glanceResult([
            { type: "header", title: "指的是哪一条？", icon: "warning" },
            {
              type: "list",
              rows: candidates.slice(0, 6).map((candidate) => ({
                title: `${candidate.sampleId} · ${candidate.condition}`,
                subtitle: candidate.measurementId,
                trailing: String(candidate.value),
              })),
            },
          ]),
        });
      }
      return spokenError(error);
    }
  }

  let result;
  try {
    result = await post("correct", {
      input: { measurementId, value, source: "voice", reason: text(args.reason) },
    });
  } catch (error) {
    await logVoice("correct_measurement", spoken, { success: false, errorMessage: error.message });
    return spokenError(error);
  }

  const row = result.measurements.find((m) => m.id === measurementId);
  await logVoice("correct_measurement", spoken, { payload: { measurementId, value } });

  return toolResult({
    corrected: row ?? null,
    summary: result.summary,
    narrationHint: `改好了，${row?.condition ?? "那条测量"} 现在是 ${value}。旧值留在审计日志里，来源记的是语音。`,
    ...glanceResult([
      { type: "header", title: "已修正", icon: "sparkle", trailing: String(value) },
      {
        type: "list",
        rows: [
          { title: `${row?.sampleId ?? "?"} · ${row?.condition ?? ""}`, subtitle: "旧值保留在审计日志", trailing: String(value) },
        ],
      },
      { type: "badges", items: [{ text: "来源 voice", tone: "good" }, { text: "旧值未丢失", tone: "neutral" }] },
    ]),
  });
}

async function annotateSample(args) {
  const sampleCode = text(args.sample_code);
  const content = text(args.content);
  if (!sampleCode || !content) {
    return spokenError(new ApiError(422, { error: "需要样本编号和说明。", code: "invalid_input" }));
  }
  const annotationType = ["contamination", "note", "flag"].includes(args.annotation_type)
    ? args.annotation_type
    : "contamination";
  const exclude = args.exclude_from_analysis !== false && annotationType === "contamination";

  let result;
  try {
    result = await post("annotate", {
      input: {
        experimentId: EXPERIMENT_ID,
        sampleCode,
        annotationType,
        content,
        excludeFromAnalysis: exclude,
        source: "voice",
      },
    });
  } catch (error) {
    await logVoice("annotate_sample", `${sampleCode}: ${content}`, {
      success: false,
      errorMessage: error.message,
    });
    return spokenError(error);
  }

  const affected = result.measurements.filter((m) => m.sampleId === sampleCode);
  await logVoice("annotate_sample", `${sampleCode}: ${content}`, {
    payload: { sampleCode, annotationType, exclude },
  });

  return toolResult({
    sampleCode,
    annotationType,
    excludedFromAnalysis: exclude,
    affectedMeasurements: affected.length,
    summary: result.summary,
    narrationHint: exclude
      ? `样本 ${sampleCode} 标为${annotationType === "contamination" ? "污染" : "已标记"}，它的 ${affected.length} 条读数一起退出了分析。数值一个都没改。`
      : `给样本 ${sampleCode} 加了备注，分析不受影响。`,
    ...glanceResult([
      { type: "header", title: `样本 ${sampleCode}`, icon: "warning", trailing: annotationType },
      { type: "list", rows: [{ title: content, subtitle: `${affected.length} 条读数受影响` }] },
      {
        type: "badges",
        items: exclude
          ? [{ text: "已移出分析", tone: "bad" }, { text: "数值未改写", tone: "neutral" }]
          : [{ text: "仅备注", tone: "neutral" }],
      },
    ]),
  });
}

async function startExperiment(args) {
  const input = {
    experimentCode: text(args.experiment_code),
    title: text(args.title),
    organism: text(args.organism),
    treatmentVariable: text(args.treatment_variable),
    measurementType: text(args.measurement_type),
    source: "voice",
  };
  if (Object.values(input).some((value) => value === null)) {
    return spokenError(
      new ApiError(422, { error: "开始实验需要编号、标题、对象、自变量和测量类型。", code: "invalid_input" }),
    );
  }

  let experiment;
  try {
    experiment = await post("start", { input });
  } catch (error) {
    await logVoice("start_experiment", input.title, { success: false, errorMessage: error.message });
    return spokenError(error);
  }
  await logVoice("start_experiment", input.title, { payload: input });

  return toolResult({
    experiment,
    note:
      experiment.id === EXPERIMENT_ID
        ? null
        : `新实验 id 为 ${experiment.id}。把它填进设置里的「默认实验 ID」才会成为后续短句子的上下文。`,
    narrationHint: `实验 ${experiment.experimentCode} 已经开着了，测量类型 ${experiment.measurementType}。`,
    ...glanceResult([
      { type: "header", title: experiment.title, icon: "sparkle", trailing: experiment.experimentCode },
      {
        type: "keyValue",
        pairs: [
          ["对象", experiment.organism],
          ["自变量", experiment.treatmentVariable],
          ["测量", experiment.measurementType],
        ],
      },
      { type: "badges", items: [{ text: experiment.status, tone: "good" }] },
    ]),
  });
}

async function queryExperiment(args) {
  const data = await snapshot();
  const measurementType = text(args.measurement_type) || data.experiment.measurementType;
  const direction = args.direction === "lower" ? "lower" : "higher";

  const scoped = data.summary.filter((entry) => entry.measurementType === measurementType);
  if (!scoped.length) {
    return toolResult({
      experiment: data.experiment.experimentCode,
      measurementType,
      summary: [],
      narrationHint: `${measurementType} 目前还没有有效读数。`,
      ...glanceResult([
        { type: "header", title: "还没有有效读数", icon: "book", trailing: measurementType },
      ]),
    });
  }

  const ranked = [...scoped].sort((a, b) => (direction === "higher" ? b.mean - a.mean : a.mean - b.mean));
  const best = ranked[0];
  const excludedCount = data.measurements.filter((m) => m.effectiveStatus === "excluded").length;
  const flagged = data.samples.filter((sample) => sample.status !== "valid").map((sample) => sample.sampleCode);

  return toolResult({
    experiment: data.experiment.experimentCode,
    measurementType,
    direction,
    best,
    ranking: ranked,
    excludedMeasurements: excludedCount,
    flaggedSamples: flagged,
    method:
      "按 condition 分组求均值，只统计有效读数；被单独排除的读数和被标记的样本都不计入。",
    narrationHint:
      `${best.condition} 的平均 ${measurementType} 最${direction === "higher" ? "高" : "低"}，` +
      `${best.mean.toFixed(2)}，来自 ${best.n} 次读数。` +
      (excludedCount ? `有 ${excludedCount} 条读数被排除在外` : "没有读数被排除") +
      (flagged.length ? `，样本 ${flagged.join("、")} 被标记。` : "。"),
    ...glanceResult([
      { type: "header", title: `${best.condition} 最${direction === "higher" ? "高" : "低"}`, icon: "sparkle", trailing: best.mean.toFixed(2) },
      {
        type: "bars",
        labels: ranked.slice(0, 7).map((entry) => entry.condition),
        values: ranked.slice(0, 7).map((entry) => Number(entry.mean.toFixed(3))),
        unit: measurementType,
      },
      {
        type: "badges",
        items: [
          { text: `${excludedCount} 条已排除`, tone: excludedCount ? "bad" : "neutral" },
          { text: `n=${best.n}`, tone: "neutral" },
        ],
      },
    ]),
  });
}

const HANDLERS = {
  record_measurement: recordMeasurement,
  correct_measurement: correctMeasurement,
  annotate_sample: annotateSample,
  start_experiment: startExperiment,
  query_experiment: queryExperiment,
};

/* --------------------------------------------------------------- protocol */

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(request) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: MANIFEST.name, version: MANIFEST.version },
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return;

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, { tools: TOOLS });

    case "tools/call": {
      const handler = HANDLERS[params?.name];
      if (!handler) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        return reply(id, await handler(params.arguments || {}));
      } catch (error) {
        return reply(
          id,
          error instanceof ApiError
            ? spokenError(error)
            : toolResult({ error: "tool_failed", message: String(error?.message || error) }, { isError: true }),
        );
      }
    }

    default:
      if (id !== undefined && id !== null) fail(id, -32601, `Method not found: ${method}`);
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  const raw = line.trim();
  if (!raw) return;
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    return fail(null, -32700, "Parse error");
  }
  try {
    await handle(request);
  } catch (error) {
    if (request?.id != null) fail(request.id, -32603, String(error?.message || error));
  }
});

// stdout is the MCP wire; diagnostics belong on stderr.
process.stderr.write(`LabPilot Voice MCP ready · ${BASE_URL} · ${EXPERIMENT_ID}\n`);
