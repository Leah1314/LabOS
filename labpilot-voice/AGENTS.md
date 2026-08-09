# Working on the LabPilot Voice integration (guide for AI coding agents)

You are editing a **VoiceOS integration**: a folder VoiceOS installs and runs as
a local MCP server. The researcher speaks, VoiceOS routes the intent to one of
these tools, the tool writes through the LabPilot API, and the notch shows a
card while the model narrates the JSON.

## Files

- `voiceos.integration.json` — identity, runtime, permissions, preferences, and
  the five tools (name / description / inputSchema / confirmation).
  **Every manifest tool must be registered in `server.mjs` with the same name,
  and vice versa.** `server.mjs` generates `tools/list` from this file so the
  two cannot drift.
- `run.sh` — the launcher VoiceOS invokes. It resolves a real `node` binary
  itself because VoiceOS is a GUI app and macOS GUI processes do not inherit
  your shell `PATH`; a bare `node` in the manifest fails at handshake when node
  came from nvm.
- `server.mjs` — MCP stdio server. Zero dependencies: the JSON-RPC transport and
  `glanceResult` are implemented here because `@voiceos/integration-sdk` is not
  published on the public registry during developer preview.
- `glance.mjs` — `glanceResult([...])`, which injects `_voiceos_glance` into the
  tool payload and enforces the card caps.
- `validate-manifest.mjs` — the manifest rules VoiceOS itself enforces.
- `verify.mjs` — validates, launches `bash run.sh`, and exercises all five tools
  against a running LabPilot. Run this before touching the notch.

## The one rule that shapes everything

**This process must never become a second place where scientific rules are
decided.** Validation, idempotency, the audit log and the analytics all live
behind the LabPilot API. A tool here parses what was said, calls the API, and
renders the answer. If you are tempted to compute a mean or decide whether a
value is plausible in this file, put it in `lib/labpilot/` instead.

## Rules that make an integration feel native

1. **Tool descriptions are routing rules for the model**: what it does plus when
   to use it (`Use when the user asks …`), with utterances in the languages the
   researcher actually speaks.
2. **Results carry data and a card**: JSON for the model to narrate, plus
   `glanceResult([...])` for the notch. Never put information only in the card.
3. **Cards are a two-second read** — at most 3 blocks and 1 chart. Vocabulary:
   `header` {icon?, title, trailing?}, `list` {rows: [{title, subtitle?,
   trailing?}]} (≤6), `stats` {items: [{label, value, tone?}]} (≤3), `keyValue`
   {pairs: [[label, value]]} (≤5), `bars` {labels, values, unit?} / `line` /
   `splitBar` (max one chart), `badges` {items} (≤3). tone is
   `neutral` | `good` | `bad`. Off-schema blocks are silently dropped.
4. **Anything that acts declares a `confirmation` card.** Inputs bind to
   arguments with `{{argName}}`; the edited values are what execute. The
   `footer` lives **inside** `root` and is an array, and an `actions` block
   carries `items: [{label, role}]` with exactly one `confirm` and one `cancel`.
   `query_experiment` is read-only and must not declare one.
5. **Be honest.** A refused write is a result, not a failure to smooth over.
   A possible duplicate and an ambiguous correction both come back as a
   question for the researcher — never a guess. Use `console.error` for
   logging; stdout is the MCP wire.
6. **Provenance is not negotiable.** Every write sends `source: "voice"`. The
   API rejects any other value from this client, and that is deliberate.
7. **Log the turn.** Every tool writes a `voice_events` row so the dashboard can
   show what was said, what it became, and whether it worked — including when
   it failed.

## Dev loop

```bash
npm run dev            # in the repo root, starts LabPilot on :3000
node verify.mjs        # here, exercises everything end to end
```

Then in VoiceOS: **Settings → Agent Mode → Integrations → Install from folder**,
pick this folder, and reload after edits.

## Definition of done

- Manifest tools and `server.mjs` registrations match exactly.
- Each description says when the model should call it.
- Acting tools have confirmation cards; `query_experiment` does not.
- `node verify.mjs` is green, including the card caps.
- Cards read in two seconds.
