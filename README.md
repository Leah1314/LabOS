# LabOS

LabOS is an operating layer for modern scientific labs. Its first product, **LabPilot**, helps wet-lab researchers capture experimental measurements as structured data and turn them into live, usable experiment views.

## LabPilot Voice

LabPilot Voice is a hands-free interface for wet-lab work built around one principle:

> **Speech-to-schema, not speech-to-text.**

The long-term workflow is:

```text
Voice → structured scientific data → database → live table/chart
      → correction, annotation, and query
```

Voice input is not implemented yet. The first product slice proves the shared data pipeline that both manual entry and future voice tools will use:

```text
Manual measurement input
          │
          ▼
Reusable LabPilot services → structured database → measurement table + live chart
          ▲
          │
     VoiceOS tools (later)
```

## First working slice

The initial demo centers on experiment **EXP-042**:

- **Title:** Inulin effect on Bifidobacterium growth
- **Organism:** Bifidobacterium
- **Treatment variable:** Inulin concentration
- **Measurement:** OD600
- **Status:** Running

The experiment workspace is designed to support:

- manual measurement entry with validation
- structured experiment and measurement records
- a raw measurement table
- a live bar chart containing valid measurements
- correction of an existing measurement without duplication
- exclusion of a measurement while preserving it in the raw table
- deterministic analytics such as average value and highest observed condition
- automatic UI refresh after database changes

Example synthetic demo measurements:

| Sample | Condition | Measurement | Value | Status | Source |
| --- | --- | --- | ---: | --- | --- |
| A | Control | OD600 | 0.41 | Valid | Manual |
| B | 1% Inulin | OD600 | 0.53 | Valid | Manual |
| C | 2% Inulin | OD600 | 0.68 | Valid | Manual |

The correction flow updates sample C from `0.68` to `0.63` in place. Excluded records remain visible in the table but are omitted from charts and analytics.

> The demo data is synthetic. Results describe observed values only and do not establish biological causality.

## Planned service interface

UI and future VoiceOS integrations will share deterministic service functions:

- `createExperiment()`
- `recordMeasurement()`
- `getMeasurementsForExperiment()`
- `correctMeasurement()`
- `excludeMeasurement()`

VoiceOS can later expose these services through tools such as:

- `start_experiment`
- `record_measurement`
- `correct_measurement`
- `annotate_sample`
- `query_experiment`

Database operations remain explicit and schema-bound; natural-language input will never generate arbitrary SQL.

## Project status

Milestone 1 is implemented as a working EXP-042 experiment workspace with database-backed manual entry, correction history, exclusion and restoration, deterministic analytics, a raw measurement table, and a responsive valid-only chart.

## Development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

The current preview uses a Cloudflare D1 database through a narrow service layer so the first slice can run without external credentials. The domain functions are isolated in `lib/labpilot/server.ts`; a Supabase adapter can replace the persistence implementation without changing the manual form or future VoiceOS/MCP tools.

Useful checks:

```bash
npm run build
npm test
```

## Architecture

- `app/page.tsx` - experiment workspace and manual interactions
- `app/api/experiment/route.ts` - deterministic HTTP action boundary
- `lib/labpilot/server.ts` - reusable experiment and measurement services
- `lib/labpilot/analytics.ts` - valid-only deterministic analysis
- `db/schema.ts` - experiment, measurement, and revision schema
- `drizzle/` - generated database migration

The next milestone is the Supabase production adapter and Realtime subscription, followed by the five VoiceOS/MCP tools defined in the product guide.

## License

A license has not yet been selected.
