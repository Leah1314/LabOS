"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LabPilotRequestError,
  annotateSample,
  correctMeasurement,
  excludeMeasurement,
  getExperiment,
  recordMeasurement,
  restoreMeasurement,
  restoreSample,
  seedDemo,
  type RecordMeasurementRequest,
} from "../lib/labpilot/client";
import { getAverageMeasurement, getBestCondition, getValidMeasurements } from "../lib/labpilot/analytics";
import type {
  ActivityEvent,
  ExperimentSnapshot,
  MeasurementEvent,
  MeasurementView,
} from "../lib/labpilot/types";

type CleanupFilter = "all" | "valid" | "excluded";

const emptyMeasurements: MeasurementView[] = [];
const emptyEvents: MeasurementEvent[] = [];

const emptyActivity: ActivityEvent = {
  captured: "Waiting for a measurement…",
  structured: "No structured action yet",
  changed: "Experiment is ready",
  timestamp: "Now",
};

const CHANGE_LABEL: Record<MeasurementEvent["changeType"], string> = {
  recorded: "recorded",
  value_corrected: "corrected",
  excluded: "excluded",
  restored: "restored",
};

export default function Home() {
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot | null>(null);
  const snapshotRef = useRef<ExperimentSnapshot | null>(null);
  const [activity, setActivity] = useState(emptyActivity);
  const [message, setMessage] = useState("Loading experiment…");
  const [syncHealth, setSyncHealth] = useState<"live" | "syncing" | "error">("syncing");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [duplicate, setDuplicate] = useState<{ message: string; input: RecordMeasurementRequest } | null>(null);
  const [cleanupFilter, setCleanupFilter] = useState<CleanupFilter>("all");
  const [cleanupSearch, setCleanupSearch] = useState("");
  const [form, setForm] = useState({
    sampleId: "",
    condition: "",
    measurementType: "OD600",
    value: "",
    treatment: "Inulin",
    concentration: "",
    unit: "OD",
  });

  /**
   * Responses are applied by issue order, never by arrival order.
   *
   * Without this, the one-second poll and a save could resolve out of order and
   * a stale snapshot would roll the freshly saved value back on screen for a
   * second. `mutating` additionally parks the poll while a write is in flight,
   * so a poll issued mid-write cannot read the pre-commit state and win.
   */
  const seqRef = useRef(0);
  const appliedRef = useRef(0);
  const pollingRef = useRef(false);
  const mutatingRef = useRef(false);

  const applySnapshot = useCallback((next: ExperimentSnapshot, seq: number) => {
    if (seq <= appliedRef.current) return false;
    appliedRef.current = seq;
    snapshotRef.current = next;
    setSnapshot(next);
    setLastSyncedAt(next.syncedAt);
    setSyncHealth("live");
    return true;
  }, []);

  useEffect(() => {
    let stopped = false;

    async function sync(initial = false) {
      if (!initial && (document.visibilityState === "hidden" || pollingRef.current || mutatingRef.current)) {
        return;
      }
      pollingRef.current = true;
      const seq = ++seqRef.current;
      try {
        const next = await getExperiment();
        if (stopped) return;
        const previous = snapshotRef.current;
        if (!applySnapshot(next, seq)) return;
        const external = previous ? describeSnapshotChange(previous, next) : null;
        if (external) {
          setActivity(external);
          setMessage("New data received · dashboard refreshed");
        } else if (initial) {
          setMessage("Experiment synced");
        }
      } catch (error) {
        if (stopped) return;
        setSyncHealth("error");
        setMessage(error instanceof Error ? error.message : "Live sync paused");
      } finally {
        pollingRef.current = false;
      }
    }

    void sync(true);
    const interval = window.setInterval(() => void sync(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [applySnapshot]);

  const measurements = snapshot?.measurements ?? emptyMeasurements;
  const summary = useMemo(() => snapshot?.summary ?? [], [snapshot]);
  const events = snapshot?.events ?? emptyEvents;
  const valid = useMemo(() => getValidMeasurements(measurements), [measurements]);
  const excluded = useMemo(
    () => measurements.filter((measurement) => measurement.effectiveStatus === "excluded"),
    [measurements],
  );
  const bestResult = useMemo(() => getBestCondition(measurements), [measurements]);
  const best = bestResult?.best ?? null;
  const average = useMemo(() => getAverageMeasurement(measurements), [measurements]);

  const eventsByMeasurement = useMemo(() => {
    const grouped = new Map<string, MeasurementEvent[]>();
    for (const event of events) {
      const existing = grouped.get(event.measurementId) ?? [];
      existing.push(event);
      grouped.set(event.measurementId, existing);
    }
    return grouped;
  }, [events]);

  const filteredMeasurements = useMemo(() => {
    const query = cleanupSearch.trim().toLowerCase();
    return measurements.filter((measurement) => {
      if (cleanupFilter !== "all" && measurement.effectiveStatus !== cleanupFilter) return false;
      if (!query) return true;
      return [
        measurement.sampleId,
        measurement.condition,
        measurement.measurementType,
        measurement.source,
        measurement.exclusionReason ?? "",
        measurement.sampleStatus,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [cleanupFilter, cleanupSearch, measurements]);

  const run = useCallback(
    async (action: () => Promise<ExperimentSnapshot>, nextActivity: ActivityEvent) => {
      setBusy(true);
      setIssues([]);
      mutatingRef.current = true;
      setMessage("Updating experiment…");
      const seq = ++seqRef.current;
      try {
        const next = await action();
        applySnapshot(next, seq);
        setActivity(nextActivity);
        setDuplicate(null);
        setMessage("Saved · live view refreshed");
        return true;
      } catch (error) {
        if (error instanceof LabPilotRequestError) {
          setMessage(error.message);
          const details = error.details as { issues?: { field: string; message: string }[] } | undefined;
          if (details?.issues) setIssues(details.issues.map((issue) => `${issue.field}: ${issue.message}`));
        } else {
          setMessage(error instanceof Error ? error.message : "Update failed");
        }
        return false;
      } finally {
        mutatingRef.current = false;
        setBusy(false);
      }
    },
    [applySnapshot],
  );

  const submitMeasurement = useCallback(
    async (input: RecordMeasurementRequest, captured: string) => {
      setBusy(true);
      setIssues([]);
      mutatingRef.current = true;
      const seq = ++seqRef.current;
      try {
        const next = await recordMeasurement(input);
        applySnapshot(next, seq);
        setDuplicate(null);
        setActivity({
          captured,
          structured: `record_measurement · ${input.condition} · ${input.measurementType} ${input.value}`,
          changed: "Measurement row created",
          timestamp: "Just now",
        });
        setMessage("Saved · live view refreshed");
      } catch (error) {
        if (error instanceof LabPilotRequestError) {
          setMessage(error.message);
          // The server refuses a reading that looks like a replay. Surfacing the
          // choice is the point: the researcher decides, the system does not guess.
          if (error.code === "possible_duplicate") setDuplicate({ message: error.message, input });
          const details = error.details as { issues?: { field: string; message: string }[] } | undefined;
          if (details?.issues) setIssues(details.issues.map((issue) => `${issue.field}: ${issue.message}`));
        } else {
          setMessage(error instanceof Error ? error.message : "Update failed");
        }
      } finally {
        mutatingRef.current = false;
        setBusy(false);
      }
    },
    [applySnapshot],
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(form.value);
    const concentration = form.concentration === "" ? null : Number(form.concentration);
    void submitMeasurement(
      {
        experimentId: "exp-042",
        sampleCode: form.sampleId,
        condition: form.condition,
        organism: snapshot?.experiment.organism ?? "Bifidobacterium",
        treatment: form.treatment || null,
        concentration,
        concentrationUnit: concentration === null ? null : "%",
        measurementType: form.measurementType,
        value,
        unit: form.unit || null,
        source: "manual",
      },
      `${form.sampleId}, ${form.condition}, ${form.measurementType} ${form.value}`,
    );
    setForm((current) => ({ ...current, sampleId: "", condition: "", value: "", concentration: "" }));
  }

  if (!snapshot) {
    return (
      <main className="loading">
        <div className="pulse" />
        <p>{message}</p>
      </main>
    );
  }

  const chartMax = Math.max(...summary.map((entry) => entry.mean), 0.8);
  const contaminatedSamples = snapshot.samples.filter((sample) => sample.status !== "valid");

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">
          <span className="brandMark">LP</span>
          <span>LabPilot</span>
          <span className="voiceLabel">VOICE</span>
        </div>
        <div className="navMeta">
          <span className={`syncDot ${syncHealth}`} />
          <span className="syncCopy">
            {message}
            {lastSyncedAt && <small> · {formatClock(lastSyncedAt)}</small>}
          </span>
          <span className="avatar">LZ</span>
        </div>
      </nav>

      <section className="hero">
        <div>
          <div className="eyebrow">
            <span>{snapshot.experiment.experimentCode}</span>
            <span className="liveBadge">
              <i /> LIVE DATA
            </span>
          </div>
          <h1>{snapshot.experiment.title}</h1>
          <p>
            <em>{snapshot.experiment.organism}</em> × {snapshot.experiment.treatmentVariable} ·{" "}
            {snapshot.experiment.measurementType}
          </p>
        </div>
        <button
          className="seedButton"
          onClick={() =>
            void run(seedDemo, {
              captured: "Load demo measurements",
              structured: "seed · 3 manual OD600 records",
              changed: "Demo dataset inserted",
              timestamp: "Just now",
            })
          }
          disabled={busy || snapshot.measurements.length > 0}
        >
          Load demo data
        </button>
      </section>

      {issues.length > 0 && (
        <section className="banner issueBanner">
          <b>Rejected before it reached the database</b>
          <ul>
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      )}

      {duplicate && (
        <section className="banner duplicateBanner">
          <div>
            <b>Possible duplicate</b>
            <small>{duplicate.message}</small>
          </div>
          <div className="bannerActions">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void submitMeasurement(
                  { ...duplicate.input, allowDuplicate: true, requestId: crypto.randomUUID() },
                  `Confirmed repeat reading for sample ${duplicate.input.sampleCode}`,
                )
              }
            >
              Record anyway
            </button>
            <button type="button" className="secondaryAction" onClick={() => setDuplicate(null)}>
              Discard
            </button>
          </div>
        </section>
      )}

      <section className="metricRow">
        <article>
          <span>VALID READINGS</span>
          <strong>{valid.length}</strong>
          <small>of {measurements.length} total</small>
        </article>
        <article>
          <span>AVERAGE {snapshot.experiment.measurementType}</span>
          <strong>{average === null ? "—" : average.toFixed(2)}</strong>
          <small>valid measurements</small>
        </article>
        <article className="bestMetric">
          <span>HIGHEST MEAN</span>
          <strong>{best?.condition ?? "—"}</strong>
          <small>
            {best ? `${best.mean.toFixed(2)} ${best.measurementType} · n=${best.n}` : "No valid readings"}
          </small>
        </article>
        <article className={excluded.length ? "attentionMetric" : "cleanMetric"}>
          <span>DATA CLEANUP</span>
          <strong>{excluded.length}</strong>
          <small>{events.length} audited changes</small>
        </article>
      </section>

      <section className="workspace">
        <article className="panel tablePanel">
          <header>
            <div>
              <span className="sectionNumber">01</span>
              <h2>Live measurements &amp; cleanup</h2>
            </div>
            <span className="recordCount">{measurements.length} raw records</span>
          </header>

          <div className="cleanupBar">
            <div className="filterGroup" aria-label="Filter measurement records">
              {(["all", "valid", "excluded"] as const).map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={cleanupFilter === filter ? "active" : ""}
                  aria-pressed={cleanupFilter === filter}
                  onClick={() => setCleanupFilter(filter)}
                >
                  {filter}{" "}
                  {filter === "all" ? measurements.length : filter === "valid" ? valid.length : excluded.length}
                </button>
              ))}
            </div>
            <label className="cleanupSearch">
              <span>Search records</span>
              <input
                value={cleanupSearch}
                onChange={(event) => setCleanupSearch(event.target.value)}
                placeholder="Sample, condition, status…"
              />
            </label>
          </div>

          <div className="qualityStrip">
            <span>
              <b>{excluded.length}</b> excluded from analysis
            </span>
            <span>
              <b>{events.length}</b> audited changes preserved
            </span>
            <span>
              <b>{contaminatedSamples.length}</b> flagged samples
            </span>
            <span>Raw records are never deleted</span>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Sample</th>
                  <th>Condition</th>
                  <th>Measurement</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Audit</th>
                  <th>Cleanup</th>
                </tr>
              </thead>
              <tbody>
                {filteredMeasurements.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="emptyCell">
                      {measurements.length === 0
                        ? "No measurements yet. Add one or load the synthetic demo."
                        : "No records match this cleanup view."}
                    </td>
                  </tr>
                ) : (
                  filteredMeasurements.map((measurement) => (
                    <MeasurementRow
                      // Keyed by identity alone. Folding `updatedAt` into the key
                      // remounted the row on every change, which slammed the audit
                      // trail shut at the exact moment it became interesting.
                      key={measurement.id}
                      measurement={measurement}
                      events={eventsByMeasurement.get(measurement.id) ?? []}
                      busy={busy}
                      onCorrect={(value) =>
                        void run(() => correctMeasurement(measurement.id, value, "manual"), {
                          captured: `Correct ${measurement.condition} to ${value}`,
                          structured: `correct_measurement · ${measurement.sampleId}`,
                          changed: `${measurement.value} → ${value}; revision preserved`,
                          timestamp: "Just now",
                        })
                      }
                      onExclude={(reason) =>
                        void run(() => excludeMeasurement(measurement.id, reason, "manual"), {
                          captured: `Exclude reading for sample ${measurement.sampleId}`,
                          structured: `exclude_measurement · ${measurement.condition}`,
                          changed: `${reason}; removed from chart and analytics`,
                          timestamp: "Just now",
                        })
                      }
                      onFlagSample={(reason) =>
                        void run(
                          () =>
                            annotateSample({
                              experimentId: measurement.experimentId,
                              sampleCode: measurement.sampleId,
                              annotationType: "contamination",
                              content: reason,
                              excludeFromAnalysis: true,
                              source: "manual",
                            }),
                          {
                            captured: `Sample ${measurement.sampleId} looks contaminated`,
                            structured: `annotate_sample · contamination · ${measurement.sampleId}`,
                            changed: "Every reading on that sample left the analysis; values untouched",
                            timestamp: "Just now",
                          },
                        )
                      }
                      onRestore={() =>
                        void run(() => restoreMeasurement(measurement.id, "manual"), {
                          captured: `Restore reading for sample ${measurement.sampleId}`,
                          structured: `restore_measurement · ${measurement.condition}`,
                          changed: "Returned to chart and analytics",
                          timestamp: "Just now",
                        })
                      }
                      onRestoreSample={() =>
                        void run(() => restoreSample(measurement.experimentId, measurement.sampleId), {
                          captured: `Clear the flag on sample ${measurement.sampleId}`,
                          structured: `restore_sample · ${measurement.sampleId}`,
                          changed: "Sample returned to the analysis set",
                          timestamp: "Just now",
                        })
                      }
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel chartPanel">
          <header>
            <div>
              <span className="sectionNumber">02</span>
              <h2>Mean {snapshot.experiment.measurementType} by condition</h2>
            </div>
            <span className="validOnly">
              <i /> VALID ONLY
            </span>
          </header>
          <div
            className="chart"
            role="img"
            aria-label={`Bar chart of mean ${snapshot.experiment.measurementType} per condition`}
          >
            <div className="yAxis">
              <span>{chartMax.toFixed(1)}</span>
              <span>{(chartMax / 2).toFixed(1)}</span>
              <span>0.0</span>
            </div>
            <div className="plot">
              {summary.length === 0 ? (
                <p className="chartEmpty">Valid readings will appear here.</p>
              ) : (
                summary.map((entry) => (
                  // Keyed by condition, not by a value that changes on every edit,
                  // so the CSS height transition actually has an old height to
                  // animate from.
                  <div className="barGroup" key={`${entry.measurementType}-${entry.condition}`}>
                    <div className="barValue">{entry.mean.toFixed(2)}</div>
                    <div className="bar" style={{ height: `${Math.max(8, (entry.mean / chartMax) * 100)}%` }} />
                    <span title={`${entry.condition} · n=${entry.n}`}>
                      {entry.condition}
                      {entry.n > 1 ? ` (n=${entry.n})` : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="chartStatus">
            <span>
              <i /> Listening for VoiceOS and API updates
            </span>
            <span>Refresh interval 1s</span>
          </div>
          <p className="chartNote">
            Condition means over valid readings. Excluded readings and flagged samples stay in the raw table but
            leave the chart and the deterministic analytics.
          </p>
        </article>
      </section>

      <section className="lowerGrid">
        <article className="panel formPanel">
          <header>
            <div>
              <span className="sectionNumber">03</span>
              <h2>Add measurement</h2>
            </div>
            <span className="manualTag">MANUAL ENTRY</span>
          </header>
          <form onSubmit={submit}>
            <label>
              Sample ID
              <input
                required
                value={form.sampleId}
                onChange={(event) => setForm({ ...form, sampleId: event.target.value })}
                placeholder="A"
              />
            </label>
            <label>
              Condition
              <input
                required
                value={form.condition}
                onChange={(event) => setForm({ ...form, condition: event.target.value })}
                placeholder="1% Inulin"
              />
            </label>
            <label>
              Measurement type
              <input
                required
                value={form.measurementType}
                onChange={(event) => setForm({ ...form, measurementType: event.target.value })}
              />
            </label>
            <label>
              Value
              <input
                required
                min="0"
                step="any"
                type="number"
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                placeholder="0.53"
              />
            </label>
            <label>
              Treatment
              <input
                value={form.treatment}
                onChange={(event) => setForm({ ...form, treatment: event.target.value })}
              />
            </label>
            <label>
              Concentration (%)
              <input
                min="0"
                step="any"
                type="number"
                value={form.concentration}
                onChange={(event) => setForm({ ...form, concentration: event.target.value })}
                placeholder="1"
              />
            </label>
            <button disabled={busy}>+ Record measurement</button>
          </form>
        </article>

        <article className="panel activityPanel">
          <header>
            <div>
              <span className="sectionNumber">04</span>
              <h2>Activity signal</h2>
            </div>
            <span className="readyTag">{snapshot.voiceEvents.length ? "VOICE LOGGED" : "VOICE-READY"}</span>
          </header>

          <ActivitySignal activity={activity} snapshot={snapshot} />

          <div className="queryResult">
            <span>DETERMINISTIC QUERY</span>
            <p>
              {best
                ? `${best.condition} has the highest mean ${best.measurementType} (${best.mean.toFixed(2)} over ${best.n} reading${best.n === 1 ? "" : "s"})${
                    bestResult?.tiedWith.length
                      ? `, tied with ${bestResult.tiedWith.map((entry) => entry.condition).join(", ")}`
                      : ""
                  }.`
                : "Add a valid reading to identify the best condition."}
            </p>
          </div>
        </article>
      </section>

      <footer>
        <span>LABPILOT VOICE · LIVE EXPERIMENT WORKSPACE</span>
        <p>Speech-to-schema foundation · Synthetic demo data</p>
      </footer>
    </main>
  );
}

/**
 * Reads the newest stored voice event when there is one, and falls back to the
 * local action otherwise. The dashboard used to fabricate all three lines from
 * hardcoded strings, so the strip was lost on refresh and a misheard utterance
 * left nothing to debug.
 */
function ActivitySignal({ activity, snapshot }: { activity: ActivityEvent; snapshot: ExperimentSnapshot }) {
  const latest = snapshot.voiceEvents[0];
  const shown: ActivityEvent = latest
    ? {
        captured: latest.rawText,
        structured:
          latest.toolName && latest.toolName !== latest.intent
            ? `${latest.intent} · ${latest.toolName}`
            : latest.intent,
        changed: latest.success ? "Applied to the experiment" : latest.errorMessage ?? "Rejected",
        timestamp: formatClock(latest.createdAt),
      }
    : activity;

  return (
    <>
      <div className="activityStep">
        <span className="stepIcon quote">“</span>
        <div>
          <small>CAPTURED</small>
          <p>{shown.captured}</p>
        </div>
      </div>
      <div className="activityLine" />
      <div className="activityStep">
        <span className="stepIcon braces">&#123;&#125;</span>
        <div>
          <small>STRUCTURED</small>
          <p>{shown.structured}</p>
        </div>
      </div>
      <div className="activityLine" />
      <div className="activityStep">
        <span className={`stepIcon ${latest && !latest.success ? "cross" : "check"}`}>
          {latest && !latest.success ? "!" : "✓"}
        </span>
        <div>
          <small>CHANGED</small>
          <p>{shown.changed}</p>
        </div>
        <time>{shown.timestamp}</time>
      </div>
      <p className="activitySource">
        {latest ? "From the stored voice_events log" : "From this browser session · no voice event stored yet"}
      </p>
    </>
  );
}

function MeasurementRow({
  measurement,
  events,
  busy,
  onCorrect,
  onExclude,
  onFlagSample,
  onRestore,
  onRestoreSample,
}: {
  measurement: MeasurementView;
  events: MeasurementEvent[];
  busy: boolean;
  onCorrect(value: number): void;
  onExclude(reason: string): void;
  onFlagSample(reason: string): void;
  onRestore(): void;
  onRestoreSample(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [value, setValue] = useState(String(measurement.value));
  const [reason, setReason] = useState(measurement.exclusionReason ?? "Possible contamination");
  const [wholeSample, setWholeSample] = useState(false);

  const numericValue = Number(value);
  const correctionValid =
    Number.isFinite(numericValue) && numericValue >= 0 && numericValue !== measurement.value;
  const sampleFlagged = measurement.sampleStatus !== "valid";

  return (
    <>
      <tr className={measurement.effectiveStatus === "excluded" ? "excluded" : ""}>
        <td>
          <b>{measurement.sampleId}</b>
          {sampleFlagged && <small className="sampleFlag">{measurement.sampleStatus}</small>}
        </td>
        <td>{measurement.condition}</td>
        <td>{measurement.measurementType}</td>
        <td>
          {editing ? (
            <span className="editValue">
              <input
                type="number"
                min="0"
                step="any"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label={`Correct value for ${measurement.condition}`}
              />
              <button
                type="button"
                disabled={!correctionValid || busy}
                onClick={() => {
                  onCorrect(numericValue);
                  setEditing(false);
                }}
              >
                Save
              </button>
              <button
                type="button"
                className="cancelEdit"
                onClick={() => {
                  setValue(String(measurement.value));
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="valueButton"
              onClick={() => {
                // Seeded here rather than mirrored in an effect: an editor that
                // opens later must not inherit a stale number, and typing must
                // never be clobbered by an update arriving mid-edit.
                setValue(String(measurement.value));
                setEditing(true);
              }}
            >
              {measurement.value.toFixed(2)}
            </button>
          )}
        </td>
        <td>
          <span className={`status ${measurement.effectiveStatus}`}>{measurement.effectiveStatus}</span>
          {measurement.exclusionReason && <small className="reason">{measurement.exclusionReason}</small>}
          {sampleFlagged && !measurement.exclusionReason && (
            <small className="reason">via flagged sample</small>
          )}
        </td>
        <td className="source">{measurement.source}</td>
        <td>
          <button type="button" className="auditButton" onClick={() => setShowAudit((current) => !current)}>
            {events.length ? `${events.length} event${events.length === 1 ? "" : "s"}` : "Original"}
          </button>
        </td>
        <td>
          {sampleFlagged ? (
            <button type="button" className="rowAction restore" disabled={busy} onClick={onRestoreSample}>
              Unflag sample
            </button>
          ) : measurement.status === "excluded" ? (
            <button type="button" className="rowAction restore" disabled={busy} onClick={onRestore}>
              Restore
            </button>
          ) : (
            <button
              type="button"
              className="rowAction"
              disabled={busy}
              onClick={() => setShowCleanup((current) => !current)}
            >
              Exclude
            </button>
          )}
        </td>
      </tr>
      {(showCleanup || showAudit) && (
        <tr className="detailRow">
          <td colSpan={8}>
            <div className="rowDetails">
              {showCleanup && measurement.effectiveStatus !== "excluded" && (
                <div className="excludeEditor">
                  <div>
                    <b>Exclude from analysis</b>
                    <small>The raw record stays visible and can be restored.</small>
                  </div>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Reason required"
                    aria-label={`Exclusion reason for sample ${measurement.sampleId}`}
                  />
                  <label className="wholeSample">
                    <input
                      type="checkbox"
                      checked={wholeSample}
                      onChange={(event) => setWholeSample(event.target.checked)}
                    />
                    <span>Whole sample (contamination)</span>
                  </label>
                  <button
                    type="button"
                    disabled={!reason.trim() || busy}
                    onClick={() => {
                      if (wholeSample) onFlagSample(reason.trim());
                      else onExclude(reason.trim());
                      setShowCleanup(false);
                    }}
                  >
                    Confirm exclusion
                  </button>
                  <button type="button" className="secondaryAction" onClick={() => setShowCleanup(false)}>
                    Cancel
                  </button>
                </div>
              )}
              {showAudit && (
                <div className="auditTrail">
                  <div className="auditTitle">
                    <b>Change history</b>
                    <small>Every change remains attributable to its real source.</small>
                  </div>
                  {events.length === 0 ? (
                    <p>
                      Original value {measurement.value.toFixed(2)} · recorded{" "}
                      {formatDateTime(measurement.createdAt)}
                    </p>
                  ) : (
                    events.map((event) => (
                      <p key={event.id}>
                        <span>
                          {CHANGE_LABEL[event.changeType]}
                          {event.changeType === "value_corrected" &&
                          event.previousValue !== null &&
                          event.revisedValue !== null
                            ? ` ${event.previousValue.toFixed(2)} → ${event.revisedValue.toFixed(2)}`
                            : ""}
                        </span>
                        <small>
                          {event.source} · {formatDateTime(event.createdAt)}
                          {event.reason ? ` · ${event.reason}` : ""}
                        </small>
                      </p>
                    ))
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function describeSnapshotChange(previous: ExperimentSnapshot, next: ExperimentSnapshot): ActivityEvent | null {
  const previousById = new Map(previous.measurements.map((measurement) => [measurement.id, measurement]));
  const created = next.measurements.filter((measurement) => !previousById.has(measurement.id));

  if (created.length) {
    const newest = created[created.length - 1];
    return {
      captured: newest.source === "voice" ? "New VoiceOS measurement" : `New ${newest.source} measurement`,
      structured:
        created.length > 1
          ? `${created.length} measurements · ${newest.measurementType}`
          : `${newest.sampleId} · ${newest.condition} · ${newest.measurementType} ${newest.value}`,
      changed:
        created.length > 1
          ? `${created.length} rows created; chart refreshed`
          : "Measurement row created; chart refreshed",
      timestamp: formatClock(newest.updatedAt),
    };
  }

  const changed = [...next.measurements]
    .reverse()
    .find((measurement) => {
      const old = previousById.get(measurement.id);
      return (
        old &&
        (old.value !== measurement.value || old.effectiveStatus !== measurement.effectiveStatus)
      );
    });

  if (!changed) return null;
  const old = previousById.get(changed.id)!;

  if (old.value !== changed.value) {
    return {
      captured: changed.source === "voice" ? "Voice correction received" : "Measurement correction received",
      structured: `correct_measurement · ${changed.condition}`,
      changed: `${old.value} → ${changed.value}; revision preserved`,
      timestamp: formatClock(changed.updatedAt),
    };
  }

  const excludedNow = changed.effectiveStatus === "excluded";
  return {
    captured: `${excludedNow ? "Exclude" : "Restore"} sample ${changed.sampleId}`,
    structured: `${excludedNow ? "annotate_sample" : "restore_measurement"} · ${changed.condition}`,
    changed: excludedNow ? "Removed from chart and analytics" : "Returned to chart and analytics",
    timestamp: formatClock(changed.updatedAt),
  };
}

function formatClock(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
