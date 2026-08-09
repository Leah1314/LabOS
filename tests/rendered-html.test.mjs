import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Surface checks only. Behaviour lives in `data-handling.test.mjs`, which runs
 * the real DDL and the real validators.
 *
 * Two classes of assertion were removed from the earlier version of this file:
 *   - three that asserted the *presence* of defects (`status !== "excluded"`,
 *     `measurementRevisions`, the unreachable "Correction is ambiguous" branch),
 *     so the suite went green because the bugs were there and would have gone
 *     red on the fix;
 *   - one that pinned the literal poll interval, which would fail on any change
 *     to the sync strategy without saying anything about correctness.
 */

test("LabPilot workspace includes the live product surface", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /LabPilot Voice \| Experiment workspace/);
  assert.match(page, /Live measurements &amp; cleanup/);
  assert.match(page, /Add measurement/);
  assert.match(page, /Activity signal/);
  assert.match(page, /Listening for VoiceOS and API updates/);
  assert.match(page, /Change history/);
  assert.match(page, /Exclude from analysis/);
  assert.match(page, /Mean \{snapshot\.experiment\.measurementType\} by condition/);
  assert.doesNotMatch(page + layout, /codex-preview|react-loading-skeleton/i);
});

test("the live view cannot be served from a cache", async () => {
  const [api, client] = await Promise.all([
    readFile(new URL("../app/api/experiment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/client.ts", import.meta.url), "utf8"),
  ]);
  assert.match(api, /dynamic = "force-dynamic"/);
  assert.match(api, /cache-control.*no-store/);
  assert.match(client, /cache: "no-store"/);
});

test("known dashboard defects stay fixed", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  // Folding a mutable field into the key remounts the row on every change,
  // which closed the audit trail at the moment it became worth reading, and
  // killed the chart's height transition.
  assert.doesNotMatch(page, /key=\{`\$\{measurement\.id\}-\$\{measurement\.updatedAt\}`\}/);
  assert.doesNotMatch(page, /key=\{`\$\{item\.id\}-\$\{item\.updatedAt\}`\}/);
  assert.match(page, /key=\{measurement\.id\}/);

  // Out-of-order responses used to roll a freshly saved value back on screen.
  assert.match(page, /appliedRef/);
  assert.match(page, /mutatingRef/);

  // The activity strip reads stored voice events instead of inventing them.
  assert.match(page, /snapshot\.voiceEvents\[0\]/);
});

test("known data-integrity defects stay fixed", async () => {
  const [analytics, service] = await Promise.all([
    readFile(new URL("../lib/labpilot/analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/server.ts", import.meta.url), "utf8"),
  ]);

  // A negated filter silently enrols any future status into the analysis set.
  assert.doesNotMatch(analytics, /status !== "excluded"/);
  assert.match(analytics, /effectiveStatus === "valid"/);

  // Corrections used to be filed as "manual" no matter where they came from.
  assert.match(service, /source: input\.source/);

  // Exclusions and restorations must leave an audit trail, not just flip a flag.
  assert.match(service, /changeType: "excluded"/);
  assert.match(service, /changeType: "restored"/);

  // Ambiguity has to be resolvable by description; by primary key it can never fire.
  assert.match(service, /ambiguous_measurement/);
});
