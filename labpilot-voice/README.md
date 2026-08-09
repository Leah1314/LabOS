# LabPilot Voice — VoiceOS integration

Speak an observation at the bench; it lands in the experiment database as a
validated row with its provenance intact, and the dashboard updates while you
are still holding the pipette.

```
"Sample B, two percent inulin, OD point six three."
        ↓  VoiceOS routes the intent
record_measurement  →  confirmation card (value editable)
        ↓  LabPilot API
validated row + audit event + voice_events entry
        ↓
notch card  ·  dashboard row  ·  chart bar
```

## Install

```bash
npm run dev          # repo root — LabPilot must be running on :3000
node verify.mjs      # here — proves the whole path before you touch the notch
```

Then in VoiceOS: **Settings → Agent Mode → Integrations → Install from folder**
and pick this folder.

Two settings appear on first use: the LabPilot address (default
`http://localhost:3000`) and the default experiment id (default `exp-042`).

## The five tools

| Tool | Confirms | Utterance |
|---|---|---|
| `record_measurement` | yes | "Sample B, two percent inulin, OD point six three." |
| `correct_measurement` | yes | "Actually two percent was point six eight." |
| `annotate_sample` | yes | "Sample C looks contaminated. Exclude it." |
| `start_experiment` | yes | "Start an inulin experiment on Bifidobacterium." |
| `query_experiment` | **no** | "Which condition performed best?" |

Reads are frictionless because they cannot damage anything. Everything that
writes shows a card first, with the parsed values editable — a misheard `0.63`
is corrected before it becomes data, not after.

## What it refuses to do

- **Guess at a duplicate.** The same reading for the same sample twice inside a
  minute comes back as a question. A retried tool call inside that minute is
  idempotent and produces no second row at all.
- **Guess at an ambiguous correction.** "Two percent was point six three" that
  matches several readings returns the candidates and asks which one.
- **Lie about where a value came from.** Every write from here is `voice`, and
  the API will not accept a client-chosen source.
- **Overwrite a measurement silently.** Corrections, exclusions and restorations
  all append to the audit log first. Flagging a contaminated sample removes its
  readings from the analysis without changing a single number.

## Notes

Zero dependencies. `@voiceos/integration-sdk` is not published on the public npm
registry during developer preview, so the MCP stdio transport and
`glanceResult()` are implemented here against the documented contract, and
`validate-manifest.mjs` reimplements the rules VoiceOS itself enforces.

`run.sh` resolves node itself: VoiceOS is a GUI app, and macOS GUI processes do
not inherit your shell `PATH`, so a bare `node` in the manifest dies at
handshake when node came from nvm.

The `network` permission lists `localhost` and `127.0.0.1`. Pointing this at a
deployed LabPilot means adding that domain to the manifest as well as to the
setting.
