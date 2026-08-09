import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { DDL } from "../db/ddl.ts";
import {
  normalizeSampleCode,
  parseAnnotateSample,
  parseRecordMeasurement,
  parseResolveMeasurement,
} from "../lib/labpilot/validation.ts";
import { getBestCondition, getValidMeasurements, summarizeByCondition } from "../lib/labpilot/analytics.ts";

/* ------------------------------------------------------------------ schema */

/**
 * Runs the exact DDL that ships to D1 against real SQLite. Constraints are only
 * worth anything if they actually fire, and the previous build had two
 * divergent copies of the schema — one with CHECK constraints and one without.
 */
function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const statement of DDL) db.exec(statement);
  return db;
}

const stamp = "2026-08-09T12:00:00.000Z";

function seedExperiment(db) {
  db.exec(`INSERT INTO experiments VALUES ('exp-042','EXP-042','t','Bifidobacterium','Inulin','OD600','running','${stamp}',NULL,'${stamp}','${stamp}')`);
  db.exec(`INSERT INTO samples VALUES ('s-b','exp-042','B','1% Inulin','Bifidobacterium','Inulin',1,'%','valid',NULL,'${stamp}','${stamp}')`);
}

const insertMeasurement = (db, id, requestId, value = 0.53) =>
  db.exec(
    `INSERT INTO measurements VALUES ('${id}','exp-042','s-b','OD600',${value},'OD','valid',NULL,'voice','${requestId}','${stamp}','${stamp}','${stamp}')`,
  );

test("production DDL applies cleanly to a real SQLite database", () => {
  const db = freshDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(tables, [
    "annotations",
    "experiments",
    "measurement_events",
    "measurements",
    "samples",
    "voice_events",
  ]);
  db.close();
});

test("a replayed requestId cannot become a second measurement", () => {
  const db = freshDb();
  seedExperiment(db);
  insertMeasurement(db, "m1", "req-1");
  assert.throws(() => insertMeasurement(db, "m2", "req-1"), /UNIQUE/i);
  db.close();
});

test("one sample code means one tube per experiment", () => {
  const db = freshDb();
  seedExperiment(db);
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO samples VALUES ('s-b2','exp-042','B','2% Inulin','Bifidobacterium','Inulin',2,'%','valid',NULL,'${stamp}','${stamp}')`,
      ),
    /UNIQUE/i,
  );
  db.close();
});

test("provenance and status columns reject values outside their enum", () => {
  const db = freshDb();
  seedExperiment(db);
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO measurements VALUES ('m3','exp-042','s-b','OD600',0.5,'OD','valid',NULL,'telepathy','req-9','${stamp}','${stamp}','${stamp}')`,
      ),
    /CHECK/i,
  );
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO measurements VALUES ('m4','exp-042','s-b','OD600',0.5,'OD','probably',NULL,'voice','req-10','${stamp}','${stamp}','${stamp}')`,
      ),
    /CHECK/i,
  );
  db.close();
});

test("a measurement cannot reference a sample that does not exist", () => {
  const db = freshDb();
  seedExperiment(db);
  assert.throws(
    () =>
      db.exec(
        `INSERT INTO measurements VALUES ('m5','exp-042','ghost','OD600',0.5,'OD','valid',NULL,'voice','req-11','${stamp}','${stamp}','${stamp}')`,
      ),
    /FOREIGN KEY/i,
  );
  db.close();
});

/* -------------------------------------------------------------- validation */

const validRecord = {
  experimentId: "exp-042",
  requestId: "req-1",
  sampleCode: "B",
  condition: "1% Inulin",
  organism: "Bifidobacterium",
  measurementType: "od600",
  value: 0.53,
  concentration: 1,
  concentrationUnit: "%",
  source: "voice",
};

test("a well-formed spoken measurement is accepted and normalised", () => {
  const result = parseRecordMeasurement(validRecord);
  assert.equal(result.ok, true);
  assert.equal(result.value.measurementType, "OD600");
  assert.equal(result.value.source, "voice");
});

test("sample codes spoken with filler and spacing resolve to one tube", () => {
  assert.equal(normalizeSampleCode("sample b "), "B");
  assert.equal(normalizeSampleCode("  B"), "B");
  assert.equal(normalizeSampleCode("Sample  c"), "C");
  // The old code trimmed while validating but stored the raw string, so
  // "B " and "B" became two different samples.
  assert.equal(parseRecordMeasurement({ ...validRecord, sampleCode: "b " }).value.sampleCode, "B");
});

test("a caller cannot forge the provenance of a reading", () => {
  const result = parseRecordMeasurement({ ...validRecord, source: "definitely-a-human" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === "source"));
});

test("NaN and negative concentrations are rejected", () => {
  assert.equal(parseRecordMeasurement({ ...validRecord, concentration: Number.NaN }).ok, false);
  assert.equal(parseRecordMeasurement({ ...validRecord, concentration: -1 }).ok, false);
  assert.equal(parseRecordMeasurement({ ...validRecord, value: Number.POSITIVE_INFINITY }).ok, false);
});

test("a concentration without a unit is not a scientific quantity", () => {
  const result = parseRecordMeasurement({ ...validRecord, concentrationUnit: null });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === "concentrationUnit"));
});

test("an idempotency key is mandatory", () => {
  const withoutKey = { ...validRecord };
  delete withoutKey.requestId;
  const result = parseRecordMeasurement(withoutKey);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.field === "requestId"));
});

test("every problem is reported at once so the agent can say them in one breath", () => {
  const result = parseRecordMeasurement({ experimentId: "exp-042" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.length >= 4);
});

test("a correction must describe the reading it means", () => {
  assert.equal(parseResolveMeasurement({ experimentId: "exp-042" }).ok, false);
  assert.equal(parseResolveMeasurement({ experimentId: "exp-042", condition: "2% Inulin" }).ok, true);
});

test("annotation types are constrained", () => {
  const base = { experimentId: "exp-042", sampleCode: "C", content: "cloudy", source: "voice" };
  assert.equal(parseAnnotateSample({ ...base, annotationType: "contamination" }).ok, true);
  assert.equal(parseAnnotateSample({ ...base, annotationType: "vibes" }).ok, false);
});

/* --------------------------------------------------------------- analytics */

const view = (over) => ({
  id: over.id,
  condition: over.condition,
  measurementType: over.measurementType ?? "OD600",
  value: over.value,
  effectiveStatus: over.effectiveStatus ?? "valid",
  sampleId: over.sampleId ?? "X",
});

test("the best condition is decided by the condition mean, not by one lucky replicate", () => {
  // Control has a single high outlier; 2% Inulin is consistently higher on average.
  const measurements = [
    view({ id: "1", condition: "Control", value: 0.9 }),
    view({ id: "2", condition: "Control", value: 0.1 }),
    view({ id: "3", condition: "2% Inulin", value: 0.7 }),
    view({ id: "4", condition: "2% Inulin", value: 0.7 }),
  ];

  // The old implementation returned the single largest row and would have
  // answered "Control" (0.9).
  const result = getBestCondition(measurements);
  assert.equal(result.best.condition, "2% Inulin");
  assert.equal(result.best.n, 2);
  assert.equal(result.best.mean, 0.7);
});

test("readings on a contaminated sample stop counting without being rewritten", () => {
  const measurements = [
    view({ id: "1", condition: "Control", value: 0.4 }),
    view({ id: "2", condition: "2% Inulin", value: 0.9, effectiveStatus: "excluded" }),
  ];
  assert.equal(getValidMeasurements(measurements).length, 1);
  assert.equal(getBestCondition(measurements).best.condition, "Control");
});

test("conditions are only ranked within a single measurement type", () => {
  const measurements = [
    view({ id: "1", condition: "Control", value: 0.4, measurementType: "OD600" }),
    view({ id: "2", condition: "Control", value: 7.2, measurementType: "PH" }),
  ];
  const summaries = summarizeByCondition(measurements);
  assert.equal(summaries.length, 2);
  // A pH of 7.2 must never win an OD600 comparison.
  assert.equal(getBestCondition(measurements, { measurementType: "OD600" }).best.mean, 0.4);
});

test("lower-is-better metrics are supported explicitly rather than assumed", () => {
  const measurements = [
    view({ id: "1", condition: "Control", value: 0.8 }),
    view({ id: "2", condition: "Treated", value: 0.2 }),
  ];
  assert.equal(getBestCondition(measurements, { direction: "lower" }).best.condition, "Treated");
});

test("an empty or fully excluded dataset has no best condition", () => {
  assert.equal(getBestCondition([]), null);
  assert.equal(
    getBestCondition([view({ id: "1", condition: "Control", value: 0.4, effectiveStatus: "excluded" })]),
    null,
  );
});

/* ------------------------------------------------------- schema drift guard */

/**
 * The applied DDL and the checked-in migration must describe the same database.
 *
 * This is the guard for the defect class that caused the original bug: the repo
 * carried two schema definitions, nobody compared them, and they diverged on
 * CHECK constraints. Compares effective structure rather than SQL text, since
 * the two are generated in different styles.
 */
test("the applied DDL and the checked-in migration describe the same database", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const dir = new URL("../drizzle/", import.meta.url);
  const file = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort().at(-1);
  assert.ok(file, "no migration file found");

  const migration = await readFile(new URL(file, dir), "utf8");
  const fromDdl = freshDb();
  const fromMigration = new DatabaseSync(":memory:");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) fromMigration.exec(statement);
  }

  const describe = (db) => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);

    return tables.map((table) => ({
      table,
      columns: db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((column) => `${column.name}:${column.type.toLowerCase()}:${column.notnull}:${column.pk}`)
        .sort(),
      uniqueIndexes: db
        .prepare(`PRAGMA index_list(${table})`)
        .all()
        .filter((index) => index.unique === 1)
        .map((index) =>
          db
            .prepare(`PRAGMA index_info(${index.name})`)
            .all()
            .map((column) => column.name)
            .join(","),
        )
        .sort(),
    }));
  };

  assert.deepEqual(describe(fromDdl), describe(fromMigration));

  // Both must actually enforce the enums, not merely declare them.
  for (const db of [fromDdl, fromMigration]) {
    db.exec(`INSERT INTO experiments VALUES ('e','E','t','o','v','OD600','running','${stamp}',NULL,'${stamp}','${stamp}')`);
    assert.throws(
      () => db.exec(`INSERT INTO samples VALUES ('s','e','B','c','o',NULL,NULL,NULL,'melted',NULL,'${stamp}','${stamp}')`),
      /CHECK/i,
    );
    db.close();
  }
});

test("condition grouping cannot collide across measurement types", () => {
  // Concatenating the two fields without an unambiguous separator makes
  // ("OD", "600X") and ("OD600", "X") the same group.
  const measurements = [
    view({ id: "1", condition: "600X", value: 0.2, measurementType: "OD" }),
    view({ id: "2", condition: "X", value: 0.9, measurementType: "OD600" }),
  ];
  const summaries = summarizeByCondition(measurements);
  assert.equal(summaries.length, 2);
  assert.deepEqual(
    summaries.map((s) => [s.measurementType, s.condition, s.n]).sort(),
    [
      ["OD", "600X", 1],
      ["OD600", "X", 1],
    ],
  );
});
