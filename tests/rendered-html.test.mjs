import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("LabPilot workspace includes the milestone-one product surface", async () => {
  const [page, layout, analytics, service, route, voiceServer, manifestText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/analytics.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/labpilot/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/experiment/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../integrations/labpilot-voice/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../integrations/labpilot-voice/voiceos.integration.json", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /LabPilot Voice \| Experiment workspace/);
  assert.match(page, /Live measurements/);
  assert.match(page, /Observed OD600/);
  assert.match(page, /Add measurement/);
  assert.match(page, /Activity signal/);
  assert.match(analytics, /status !== "excluded"/);
  assert.match(service, /measurementRevisions/);
  assert.match(service, /Correction is ambiguous/);
  assert.match(page, /setInterval\(\(\) => void sync\(\), 1_000\)/);
  assert.match(route, /LABPILOT_INTEGRATION_TOKEN/);
  assert.match(route, /oai-authenticated-user-email/);
  assert.match(voiceServer, /LABPILOT_API_TOKEN/);
  assert.match(voiceServer, /OAI-Sites-Authorization/);
  assert.match(voiceServer, /action: "record"/);
  assert.match(voiceServer, /action: "correct"/);
  assert.match(voiceServer, /action: "remove"/);
  assert.match(voiceServer, /const previous = db\.baseline/);
  assert.doesNotMatch(voiceServer, /const before = await api\(\)/);
  assert.match(voiceServer, /source: "voice"/);
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.permissions, [{ kind: "network", domains: ["labpilot-voice.leah-1314.chatgpt.site"] }]);
  assert.equal(manifest.preferences.find(item => item.name === "LABPILOT_API_TOKEN")?.type, "password");
  assert.equal(manifest.preferences.find(item => item.name === "LABPILOT_SITES_ACCESS_TOKEN")?.type, "password");
  const registered = [...voiceServer.matchAll(/server\.registerTool\("([a-z0-9_]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(registered, manifest.tools.map(tool => tool.name).sort());
  assert.doesNotMatch(page + layout, /codex-preview|react-loading-skeleton/i);
});
