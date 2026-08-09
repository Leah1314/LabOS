import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LabPilot workspace includes the milestone-one product surface", async () => {
  const [page, layout, analytics, service] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/server.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /LabPilot Voice \| Experiment workspace/);
  assert.match(page, /Live measurements/);
  assert.match(page, /Observed OD600/);
  assert.match(page, /Add measurement/);
  assert.match(page, /Activity signal/);
  assert.match(analytics, /status !== "excluded"/);
  assert.match(service, /measurementRevisions/);
  assert.match(service, /Correction is ambiguous/);
  assert.doesNotMatch(page + layout, /codex-preview|react-loading-skeleton/i);
});
