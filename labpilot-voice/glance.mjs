/**
 * Hand-rolled `glanceResult`.
 *
 * `@voiceos/integration-sdk` is not on the public npm registry (developer
 * preview), so we implement the documented contract ourselves: the helper
 * injects `_voiceos_glance: { blocks }` into the tool payload, and VoiceOS
 * lifts it out before the model sees the rest.
 *
 * Caps enforced here so we never ship a card that gets silently dropped:
 *   - 3 blocks per glance card
 *   - 1 chart per card (bars | line | splitBar)
 */
export const UI_SCHEMA_VERSION = 1;
export const MAX_BLOCKS = 3;
const CHART_TYPES = new Set(["bars", "line", "splitBar"]);

const LIMITS = { list: 6, stats: 3, keyValue: 5, badges: 3 };

function trim(value, max) {
  if (typeof value !== "string") return value;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalise(block) {
  if (!block || typeof block !== "object" || !block.type) return null;
  const out = { ...block };
  if (typeof out.title === "string") out.title = trim(out.title, 60);
  if (typeof out.trailing === "string") out.trailing = trim(out.trailing, 32);
  if (Array.isArray(out.rows)) {
    out.rows = out.rows.slice(0, LIMITS.list).map((r) => ({
      ...r,
      title: trim(r.title, 48),
      subtitle: trim(r.subtitle, 72),
      trailing: trim(r.trailing, 24),
    }));
  }
  if (Array.isArray(out.items)) {
    const cap = LIMITS[out.type] ?? 6;
    out.items = out.items.slice(0, cap).map((i) => ({
      ...i,
      label: trim(i.label, 24),
      value: trim(i.value, 24),
      text: trim(i.text, 28),
    }));
  }
  // A glance keyValue takes `pairs: [[label, value]]` — note that the
  // confirmation-card keyValue is a different block that takes `rows`.
  if (Array.isArray(out.pairs)) {
    out.pairs = out.pairs
      .slice(0, LIMITS.keyValue)
      .map(([label, value]) => [trim(label, 24), trim(value, 28)]);
  }
  return out;
}

export function glanceResult(blocks) {
  const clean = [];
  let charts = 0;
  for (const raw of blocks) {
    const block = normalise(raw);
    if (!block) continue;
    if (CHART_TYPES.has(block.type)) {
      if (charts >= 1) continue;
      charts += 1;
    }
    clean.push(block);
    if (clean.length === MAX_BLOCKS) break;
  }
  return { _voiceos_glance: { schemaVersion: UI_SCHEMA_VERSION, blocks: clean } };
}

/** Wrap a payload as an MCP tool result. The model narrates from this JSON. */
export function toolResult(payload, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}
