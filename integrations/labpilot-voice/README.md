# LabPilot Voice for VoiceOS

This directory is the version-controlled source for the LabPilot Voice custom MCP integration generated with VoiceOS Integration Studio.

It teaches VoiceOS to parse spoken scientific observations, record structured measurements, query experiment state, correct or undo records, and display compact glance cards in the Mac notch.

## Included source

- `voiceos.integration.json` - integration identity, runtime, tool schemas, and confirmation cards
- `server.ts` - MCP server and scientific operations
- `widgetKit.ts` - native VoiceOS glance-card rendering helpers
- `run.sh` - launcher used by VoiceOS; keep unchanged
- `studio-meta.json` - Integration Studio prompt and preview fixtures
- `AGENTS.md` - required integration contract for coding agents
- `icon.png` - integration artwork
- `package.json` and `package-lock.json` - pinned Node dependencies

Generated `node_modules` content is intentionally excluded. Install dependencies locally instead of committing them.

## Local validation

```bash
npm install
npm exec -- tsx server.ts
```

The MCP server uses standard input/output and will wait quietly for a client after startup. Stop it with `Ctrl-C`.

## Load into VoiceOS

Copy these files into a VoiceOS custom MCP folder, preserving `run.sh` and the manifest runtime exactly. Then open:

**VoiceOS Dashboard → Agent → Integration Studio → My Integrations → LabPilot Voice → Reload**

VoiceOS may assign a new generated folder suffix after a Studio reload. Keep this repository directory as the durable source of truth.

## Connect to LabOS

The integration reads and writes the deployed LabOS experiment API. In the integration settings, configure:

- `LABPILOT_API_TOKEN` — required password preference; it must match the deployment secret
- `LABPILOT_API_URL` — defaults to the production EXP-042 endpoint and normally needs no change

The token is never committed to this repository. Network access is restricted by the manifest to the production LabOS domain.

## Development contract

Read `AGENTS.md` completely before editing. In particular:

- manifest tool names and `server.ts` registrations must match exactly
- every tool result must contain structured data and a glance card
- write actions require confirmation cards
- read-only tools must not request confirmation
- secrets must come from VoiceOS preferences, never source code
- `run.sh` must remain unchanged
