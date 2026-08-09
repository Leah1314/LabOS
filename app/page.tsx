"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { correctMeasurement, excludeMeasurement, getExperiment, recordMeasurement, restoreMeasurement, seedDemo } from "../lib/labpilot/client";
import { getAverageMeasurement, getBestCondition, getValidMeasurements } from "../lib/labpilot/analytics";
import type { ActivityEvent, ExperimentSnapshot, Measurement } from "../lib/labpilot/types";

const emptyActivity: ActivityEvent = {
  captured: "Waiting for a measurement…",
  structured: "No structured action yet",
  changed: "Experiment is ready",
  timestamp: "Now",
};

export default function Home() {
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot | null>(null);
  const [activity, setActivity] = useState(emptyActivity);
  const [message, setMessage] = useState("Loading experiment…");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ sampleId: "", condition: "", measurementType: "OD600", value: "", treatment: "Inulin", concentration: "", unit: "OD" });

  useEffect(() => {
    let active = true;
    const sync = (announce = false) => getExperiment().then(data => {
      if (!active) return;
      setSnapshot(data);
      if (announce) setMessage("Experiment synced");
    }).catch(error => { if (active) setMessage(error.message); });
    void sync(true);
    const timer = window.setInterval(() => void sync(), 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  const valid = useMemo(() => getValidMeasurements(snapshot?.measurements ?? []), [snapshot]);
  const best = useMemo(() => getBestCondition(snapshot?.measurements ?? []), [snapshot]);
  const average = useMemo(() => getAverageMeasurement(snapshot?.measurements ?? []), [snapshot]);

  async function run(action: () => Promise<ExperimentSnapshot>, nextActivity: ActivityEvent) {
    setBusy(true); setMessage("Updating experiment…");
    try { const next = await action(); setSnapshot(next); setActivity(nextActivity); setMessage("Saved · visualization refreshed"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Update failed"); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(form.value);
    const concentration = form.concentration === "" ? null : Number(form.concentration);
    const captured = `${form.sampleId}, ${form.condition}, ${form.measurementType} ${form.value}`;
    void run(() => recordMeasurement({ experimentId: "exp-042", sampleId: form.sampleId, condition: form.condition, organism: "Bifidobacterium", treatment: form.treatment || null, concentration, concentrationUnit: concentration === null ? null : "%", measurementType: form.measurementType, value, unit: form.unit || null, inputSource: "manual" }), {
      captured, structured: `${form.condition} · ${form.measurementType} · ${form.value}`, changed: "Measurement row created", timestamp: "Just now",
    });
    setForm(current => ({ ...current, sampleId: "", condition: "", value: "", concentration: "" }));
  }

  if (!snapshot) return <main className="loading"><div className="pulse" /><p>{message}</p></main>;
  const maxValue = Math.max(...valid.map(item => item.value), 0.8);

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand"><span className="brandMark">LP</span><span>LabPilot</span><span className="voiceLabel">VOICE</span></div>
        <div className="navMeta"><span className="syncDot" />{message}<span className="avatar">LZ</span></div>
      </nav>

      <section className="hero">
        <div><div className="eyebrow"><span>{snapshot.experiment.experimentCode}</span><span className="liveBadge"><i /> LIVE</span></div><h1>{snapshot.experiment.title}</h1><p><em>Bifidobacterium</em> × Inulin concentration · OD600</p></div>
        <button className="seedButton" onClick={() => void run(seedDemo, { captured: "Load demo measurements", structured: "3 manual OD600 records", changed: "Demo dataset inserted", timestamp: "Just now" })} disabled={busy || snapshot.measurements.length > 0}>Load demo data</button>
      </section>

      <section className="metricRow">
        <article><span>VALID READINGS</span><strong>{valid.length}</strong><small>of {snapshot.measurements.length} total</small></article>
        <article><span>AVERAGE OD600</span><strong>{average === null ? "—" : average.toFixed(2)}</strong><small>valid measurements</small></article>
        <article className="bestMetric"><span>HIGHEST OBSERVED</span><strong>{best?.condition ?? "—"}</strong><small>{best ? `${best.value.toFixed(2)} OD600` : "No valid readings"}</small></article>
      </section>

      <section className="workspace">
        <article className="panel tablePanel">
          <header><div><span className="sectionNumber">01</span><h2>Live measurements</h2></div><span className="recordCount">{snapshot.measurements.length} records</span></header>
          <div className="tableWrap"><table><thead><tr><th>Sample</th><th>Condition</th><th>Measurement</th><th>Value</th><th>Status</th><th>Source</th><th /></tr></thead>
          <tbody>{snapshot.measurements.length === 0 ? <tr><td colSpan={7} className="emptyCell">No measurements yet. Add one or load the synthetic demo.</td></tr> : snapshot.measurements.map(measurement => <MeasurementRow key={measurement.id} measurement={measurement} busy={busy} onCorrect={(value) => void run(() => correctMeasurement(measurement.id, value), { captured: `Correct ${measurement.condition} to ${value}`, structured: `correct_measurement · ${measurement.id}`, changed: `${measurement.value} → ${value}; revision preserved`, timestamp: "Just now" })} onToggle={() => void run(() => measurement.status === "excluded" ? restoreMeasurement(measurement.id) : excludeMeasurement(measurement.id, "Possible contamination"), { captured: `${measurement.status === "excluded" ? "Restore" : "Exclude"} sample ${measurement.sampleId}`, structured: `${measurement.status === "excluded" ? "restore" : "annotate_sample"} · ${measurement.condition}`, changed: measurement.status === "excluded" ? "Returned to analysis" : "Excluded from chart and analytics", timestamp: "Just now" })} />)}</tbody></table></div>
        </article>

        <article className="panel chartPanel">
          <header><div><span className="sectionNumber">02</span><h2>Observed OD600</h2></div><span className="validOnly">VALID ONLY</span></header>
          <div className="chart" role="img" aria-label="Bar chart of valid OD600 measurements by condition">
            <div className="yAxis"><span>{maxValue.toFixed(1)}</span><span>{(maxValue / 2).toFixed(1)}</span><span>0.0</span></div>
            <div className="plot">{valid.length === 0 ? <p className="chartEmpty">Valid readings will appear here.</p> : valid.map(item => <div className="barGroup" key={item.id}><div className="barValue">{item.value.toFixed(2)}</div><div className="bar" style={{ height: `${Math.max(8, item.value / maxValue * 100)}%` }} /><span>{item.condition}</span></div>)}</div>
          </div>
          <p className="chartNote">Observed values only. Excluded samples are not included in this visualization.</p>
        </article>
      </section>

      <section className="lowerGrid">
        <article className="panel formPanel"><header><div><span className="sectionNumber">03</span><h2>Add measurement</h2></div><span className="manualTag">MANUAL INPUT</span></header>
          <form onSubmit={submit}><label>Sample ID<input required value={form.sampleId} onChange={event => setForm({ ...form, sampleId: event.target.value })} placeholder="A" /></label><label>Condition<input required value={form.condition} onChange={event => setForm({ ...form, condition: event.target.value })} placeholder="1% Inulin" /></label><label>Measurement type<input required value={form.measurementType} onChange={event => setForm({ ...form, measurementType: event.target.value })} /></label><label>Value<input required min="0" step="any" type="number" value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} placeholder="0.53" /></label><label>Treatment<input value={form.treatment} onChange={event => setForm({ ...form, treatment: event.target.value })} /></label><label>Concentration (%)<input min="0" step="any" type="number" value={form.concentration} onChange={event => setForm({ ...form, concentration: event.target.value })} placeholder="1" /></label><button disabled={busy}>+ Record measurement</button></form>
        </article>

        <article className="panel activityPanel"><header><div><span className="sectionNumber">04</span><h2>Activity signal</h2></div><span className="readyTag">VOICE-READY</span></header>
          <div className="activityStep"><span className="stepIcon quote">“</span><div><small>CAPTURED</small><p>{activity.captured}</p></div></div>
          <div className="activityLine" />
          <div className="activityStep"><span className="stepIcon braces">&#123;&#125;</span><div><small>STRUCTURED</small><p>{activity.structured}</p></div></div>
          <div className="activityLine" />
          <div className="activityStep"><span className="stepIcon check">✓</span><div><small>CHANGED</small><p>{activity.changed}</p></div><time>{activity.timestamp}</time></div>
          <div className="queryResult"><span>DETERMINISTIC QUERY</span><p>{best ? `${best.condition} has the highest observed OD600 (${best.value.toFixed(2)}).` : "Add a valid reading to identify the highest observed condition."}</p></div>
        </article>
      </section>
      <footer><span>LABPILOT VOICE · MILESTONE 1</span><p>Speech-to-schema foundation · Synthetic demo data</p></footer>
    </main>
  );
}

function MeasurementRow({ measurement, busy, onCorrect, onToggle }: { measurement: Measurement; busy: boolean; onCorrect(value: number): void; onToggle(): void }) {
  const [editing, setEditing] = useState(false); const [value, setValue] = useState(String(measurement.value));
  return <tr className={measurement.status === "excluded" ? "excluded" : ""}><td><b>{measurement.sampleId}</b></td><td>{measurement.condition}</td><td>{measurement.measurementType}</td><td>{editing ? <span className="editValue"><input type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} /><button onClick={() => { onCorrect(Number(value)); setEditing(false); }}>Save</button></span> : <button className="valueButton" onClick={() => setEditing(true)}>{measurement.value.toFixed(2)}</button>}</td><td><span className={`status ${measurement.status}`}>{measurement.status}</span>{measurement.exclusionReason && <small className="reason">{measurement.exclusionReason}</small>}</td><td className="source">{measurement.inputSource}</td><td><button className="rowAction" disabled={busy} onClick={onToggle}>{measurement.status === "excluded" ? "Restore" : "Exclude"}</button></td></tr>;
}
