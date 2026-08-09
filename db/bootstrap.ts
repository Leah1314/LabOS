import { env } from "cloudflare:workers";
import { DDL } from "./ddl";


/**
 * The milestone-one build shipped a `measurements` table without `sample_id` or
 * `request_id`. `CREATE TABLE IF NOT EXISTS` would leave that table in place and
 * every insert would fail on a missing column, so park it aside instead. Data is
 * preserved under a `_v0` name rather than dropped.
 */
async function parkLegacyTables() {
  const info = await env.DB.prepare(`PRAGMA table_info(measurements)`).all<{ name: string }>();
  const columns = new Set((info.results ?? []).map((row: { name: string }) => row.name));
  if (columns.size === 0 || columns.has("request_id")) return;

  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  await env.DB.batch([
    env.DB.prepare(`ALTER TABLE measurements RENAME TO measurements_v0_${stamp}`),
    env.DB.prepare(`DROP TABLE IF EXISTS measurement_revisions`),
  ]);
}

let ready: Promise<void> | null = null;

/**
 * Runs at most once per isolate. The previous build issued four DDL statements
 * on every single write request.
 */
export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await parkLegacyTables();
      await env.DB.batch(DDL.map((statement) => env.DB.prepare(statement)));
    })().catch((error) => {
      ready = null; // let the next request retry rather than wedging the isolate
      throw error;
    });
  }
  return ready;
}

