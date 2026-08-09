/**
 * The physical schema, as plain strings with no runtime imports, so the exact
 * DDL that ships can be executed against a real SQLite database in tests.
 *
 * This is the only DDL in the repository. The previous build declared the
 * schema twice — once in `drizzle/0000_*.sql` and once inline in the service
 * layer — and the two had already drifted: the inline copy carried CHECK
 * constraints, the migration did not, so whether your data was validated
 * depended on which code path created the table first.
 */
export const DDL = [
  `CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_code TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    organism TEXT NOT NULL,
    treatment_variable TEXT NOT NULL,
    measurement_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('draft','running','completed')),
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS samples (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL REFERENCES experiments(id),
    sample_code TEXT NOT NULL,
    condition TEXT NOT NULL,
    organism TEXT NOT NULL,
    treatment TEXT,
    concentration REAL,
    concentration_unit TEXT,
    status TEXT NOT NULL CHECK(status IN ('valid','contaminated','excluded')),
    status_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS samples_experiment_code_unique ON samples(experiment_id, sample_code)`,
  `CREATE INDEX IF NOT EXISTS samples_experiment_idx ON samples(experiment_id)`,
  `CREATE TABLE IF NOT EXISTS measurements (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL REFERENCES experiments(id),
    sample_id TEXT NOT NULL REFERENCES samples(id),
    measurement_type TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT,
    status TEXT NOT NULL CHECK(status IN ('valid','excluded')),
    exclusion_reason TEXT,
    source TEXT NOT NULL CHECK(source IN ('manual','voice','api')),
    request_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS measurements_request_unique ON measurements(experiment_id, request_id)`,
  `CREATE INDEX IF NOT EXISTS measurements_experiment_type_idx ON measurements(experiment_id, measurement_type)`,
  `CREATE INDEX IF NOT EXISTS measurements_sample_idx ON measurements(sample_id)`,
  `CREATE TABLE IF NOT EXISTS measurement_events (
    id TEXT PRIMARY KEY NOT NULL,
    measurement_id TEXT NOT NULL REFERENCES measurements(id),
    change_type TEXT NOT NULL CHECK(change_type IN ('recorded','value_corrected','excluded','restored')),
    previous_value REAL,
    revised_value REAL,
    previous_status TEXT,
    revised_status TEXT,
    reason TEXT,
    source TEXT NOT NULL CHECK(source IN ('manual','voice','api')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS measurement_events_measurement_idx ON measurement_events(measurement_id)`,
  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT NOT NULL REFERENCES experiments(id),
    sample_id TEXT REFERENCES samples(id),
    measurement_id TEXT REFERENCES measurements(id),
    annotation_type TEXT NOT NULL CHECK(annotation_type IN ('contamination','note','flag')),
    content TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('manual','voice','api')),
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS annotations_experiment_idx ON annotations(experiment_id)`,
  `CREATE TABLE IF NOT EXISTS voice_events (
    id TEXT PRIMARY KEY NOT NULL,
    experiment_id TEXT REFERENCES experiments(id),
    intent TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    parsed_payload TEXT,
    tool_name TEXT,
    success INTEGER NOT NULL,
    error_message TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS voice_events_experiment_idx ON voice_events(experiment_id)`,
];
