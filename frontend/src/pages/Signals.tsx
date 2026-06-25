import { useState } from "react";
import { api, DecayParams, SignalDef } from "../api";
import { formatTime, useAsync, useAsyncFn } from "../hooks";

function DecayCurveChart({ params }: { params: DecayParams }) {
  const W = 240;
  const H = 70;
  const totalH = params.peak_lead_time_h * 4;
  const pts: [number, number][] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * totalH;
    const y = params.amplitude * t * Math.exp(-params.lambda * t) * params.lambda * Math.E;
    pts.push([t, Math.min(1, Math.max(0, y))]);
  }
  const svgPts = pts.map(([t, y]) => `${(t / totalH) * W},${H - y * H}`).join(" ");

  return (
    <div>
      <svg width={W} height={H + 4} style={{ overflow: "visible" }}>
        <polyline points={svgPts} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {/* Peak marker */}
        <line
          x1={((params.peak_lead_time_h) / totalH) * W}
          y1={0}
          x2={((params.peak_lead_time_h) / totalH) * W}
          y2={H}
          stroke="var(--accent)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity={0.5}
        />
        <text
          x={((params.peak_lead_time_h) / totalH) * W}
          y={H + 14}
          textAnchor="middle"
          fontSize="10"
          fill="var(--text-muted)"
        >
          {params.peak_lead_time_h.toFixed(0)}h
        </text>
      </svg>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Causal power peaks at {params.peak_lead_time_h.toFixed(0)}h lead time
        · fitted from {params.n_samples} samples
      </div>
    </div>
  );
}

function SignalCard({ sig, onDeleted, onTrained }: { sig: SignalDef; onDeleted: () => void; onTrained: () => void }) {
  const trainFn = useAsyncFn(api.trainSignal);
  const deleteFn = useAsyncFn(api.deleteSignal);
  const [trainMsg, setTrainMsg] = useState<string | null>(null);

  const handleTrain = async () => {
    setTrainMsg(null);
    const result = await trainFn.run(sig.name);
    if (result !== null) {
      if (result.trained) {
        setTrainMsg("Decay curve fitted.");
        onTrained();
      } else {
        setTrainMsg(result.reason ?? "Not enough data.");
      }
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete signal "${sig.name}"?`)) return;
    const result = await deleteFn.run(sig.name);
    if (result !== null) onDeleted();
  };

  return (
    <div className="webhook-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{sig.name}</div>
          {sig.description && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sig.description}</div>}
          <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
            <span className="signal-chip">{sig.direction === "higher_is_worse" ? "higher = worse" : "lower = worse"}</span>
            {sig.decay_params ? (
              <span className="badge-ok">decay curve fitted</span>
            ) : (
              <span className="badge-warn">no curve yet</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={handleTrain} disabled={trainFn.loading}>
            {trainFn.loading ? "Training..." : "Train"}
          </button>
          <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={handleDelete} disabled={deleteFn.loading}>
            Delete
          </button>
        </div>
      </div>
      {trainMsg && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{trainMsg}</div>}
      {sig.decay_params && (
        <div style={{ marginTop: 14 }}>
          <DecayCurveChart params={sig.decay_params} />
        </div>
      )}
    </div>
  );
}

function AddSignalForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState("higher_is_worse");
  const [error, setError] = useState<string | null>(null);
  const fn = useAsyncFn(api.createSignal);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setError(null);
    const result = await fn.run(name.trim(), description.trim(), direction);
    if (result !== null) {
      setName(""); setDescription("");
      onCreated();
    } else {
      setError(fn.error);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Define Signal</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label className="form-label">Name</label>
            <input className="form-input" placeholder="support_tickets_open" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Direction</label>
            <select
              className="form-input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              style={{ cursor: "pointer" }}
            >
              <option value="higher_is_worse">Higher is worse</option>
              <option value="lower_is_worse">Lower is worse</option>
            </select>
          </div>
        </div>
        <div>
          <label className="form-label">Description (optional)</label>
          <input className="form-input" placeholder="Number of open support tickets" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={fn.loading || !name.trim()}>
          {fn.loading ? "Creating..." : "Add Signal"}
        </button>
      </div>
    </div>
  );
}

export default function Signals() {
  const { data, loading, error, refresh } = useAsync(api.signals, []);
  const signals = data?.signals ?? [];

  return (
    <>
      <h1 className="page-title">Signals</h1>
      <AddSignalForm onCreated={refresh} />
      {loading && <p className="muted">Loading...</p>}
      {error && <div className="error">{error.detail}</div>}
      {signals.map((s) => (
        <SignalCard key={s.id} sig={s} onDeleted={refresh} onTrained={refresh} />
      ))}
      {!loading && signals.length === 0 && (
        <p className="muted">No signals defined. Signals are also auto-created when you record observations.</p>
      )}
    </>
  );
}
