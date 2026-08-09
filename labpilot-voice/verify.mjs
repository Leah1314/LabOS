#!/usr/bin/env node
/**
 * Verify the integration the way VoiceOS will: validate the manifest against
 * the rules the app itself enforces, launch `bash run.sh` over stdio, handshake,
 * then call every tool against a running LabPilot.
 *
 * Also the terminal fallback demo — if the notch misbehaves on stage, this
 * prints the same cards and the same spoken lines.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { validateManifestFile } from "./validate-manifest.mjs";

const BASE_URL = (process.env.LABPILOT_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

let failures = 0;
const ok = (label) => console.log(`  \x1b[32m✓\x1b[0m ${label}`);
const bad = (label, detail) => {
  failures += 1;
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
};
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

const CHART_TYPES = new Set(["bars", "line", "splitBar"]);

console.log("\n\x1b[1mLabPilot Voice — verify\x1b[0m\n");

/* --------------------------------------------------------------- manifest */

console.log("[0/4] manifest（对照 VoiceOS.app 内的真实 zod 规则）");
const validation = validateManifestFile(join(import.meta.dirname, "voiceos.integration.json"));
check(validation.ok, "voiceos.integration.json 合法");
for (const problem of validation.errors) bad("manifest", problem);

/* ------------------------------------------------------------ reachability */

console.log("\n[1/4] LabPilot 可达性");
try {
  const response = await fetch(`${BASE_URL}/api/experiment`, { signal: AbortSignal.timeout(5000) });
  check(response.ok, `${BASE_URL} 响应 ${response.status}`);
} catch (error) {
  bad(`${BASE_URL} 不可达`, String(error?.message || error));
  console.log("\n  先在另一个终端跑 `npm run dev`，再重跑本脚本。\n");
  process.exit(1);
}

/* --------------------------------------------------------------- handshake */

const server = spawn("bash", ["run.sh"], {
  cwd: import.meta.dirname,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, LABPILOT_BASE_URL: BASE_URL },
});
server.stderr.on("data", (chunk) => process.stderr.write(`  [server] ${chunk}`));

const pending = new Map();
let nextId = 1;

createInterface({ input: server.stdout }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve) {
    pending.delete(message.id);
    resolve(message);
  }
});

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000).unref();
  });
}

function inspect(name, payload) {
  const glance = payload._voiceos_glance;
  check(!!glance, `${name}: 附带 glance 卡片`);
  if (!glance) return;
  const blocks = glance.blocks || [];
  check(blocks.length >= 1 && blocks.length <= 3, `${name}: ${blocks.length} 个区块（上限 3）`);
  check(blocks.filter((b) => CHART_TYPES.has(b.type)).length <= 1, `${name}: 图表 ≤ 1`);
  check(JSON.stringify(payload).length < 32000, `${name}: payload 未超 32000 字符`);
  check(!!payload.narrationHint, `${name}: 有可口述内容`);
  console.log(`      ${blocks.map((b) => b.type).join(" + ")}  →  “${blocks[0]?.title ?? ""}”`);
  console.log(`      \x1b[2m口述：${payload.narrationHint}\x1b[0m`);
}

async function call(name, args = {}) {
  const response = await rpc("tools/call", { name, arguments: args });
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  const payload = JSON.parse(response.result.content[0].text);
  inspect(name, payload);
  return payload;
}

console.log("\n[2/4] 握手与工具清单");
const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify", version: "0.1.0" } });
check(!!init.result?.serverInfo?.name, `initialize → ${init.result?.serverInfo?.name}`);
server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const list = await rpc("tools/list", {});
const tools = list.result.tools;
check(tools.length === 5, `tools/list → ${tools.map((t) => t.name).join(", ")}`);
for (const tool of tools) {
  check(/Use when/i.test(tool.description), `${tool.name}: description 含路由触发语`);
}
check(
  tools.find((t) => t.name === "query_experiment")?.annotations?.readOnlyHint === true,
  "query_experiment 标记为只读",
);

/* ------------------------------------------------------------------- tools */

const stamp = Date.now().toString(36).slice(-4).toUpperCase();

console.log("\n[3/4] 逐个工具（打真实 LabPilot）");
const recorded = await call("record_measurement", {
  sample_code: `sample ${stamp}`,
  condition: `verify-${stamp}`,
  measurement_type: "od600",
  value: 0.62,
  unit: "OD",
  concentration: 5,
  concentration_unit: "%",
  treatment: "Inulin",
});
check(recorded.recorded?.source === "voice", `写入来源为 voice（拿到 ${recorded.recorded?.source}）`);
check(recorded.recorded?.sampleId === stamp, `样本编号归一为 ${recorded.recorded?.sampleId}`);
check(recorded.recorded?.measurementType === "OD600", "测量类型归一为大写");

const replay = await call("record_measurement", {
  sample_code: `sample ${stamp}`,
  condition: `verify-${stamp}`,
  measurement_type: "od600",
  value: 0.62,
  unit: "OD",
});
check(
  replay.totals?.all === recorded.totals?.all,
  `同一分钟内重放不产生新行（${recorded.totals?.all} → ${replay.totals?.all}）`,
);

const corrected = await call("correct_measurement", {
  condition: `verify-${stamp}`,
  value: 0.66,
  reason: "verify pass",
});
check(corrected.corrected?.value === 0.66, `修正生效（${corrected.corrected?.value}）`);

const annotated = await call("annotate_sample", {
  sample_code: stamp,
  annotation_type: "contamination",
  content: "verify: 疑似污染",
  exclude_from_analysis: true,
});
check(annotated.excludedFromAnalysis === true, "样本被移出分析");
check(annotated.affectedMeasurements >= 1, `影响 ${annotated.affectedMeasurements} 条读数`);

const queried = await call("query_experiment", {});
check(!!queried.best?.condition, `最佳条件 ${queried.best?.condition}（mean ${queried.best?.mean?.toFixed(2)}）`);
check(
  !queried.ranking.some((entry) => entry.condition === `verify-${stamp}`),
  "被标记样本的条件已退出排名",
);

/* ------------------------------------------------------------ voice events */

console.log("\n[4/4] dashboard 的活动信号是否收到了这些语音事件");
const after = await (await fetch(`${BASE_URL}/api/experiment`)).json();
const mine = after.voiceEvents.filter((event) => String(event.rawText).includes(stamp));
check(mine.length >= 2, `voice_events 里有 ${mine.length} 条本次调用产生的记录`);
if (mine[0]) console.log(`      \x1b[2m最新一条：“${mine[0].rawText}”\x1b[0m`);

server.kill();
console.log(
  failures === 0 ? "\n\x1b[32m全部通过。\x1b[0m\n" : `\n\x1b[31m${failures} 项失败。\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
