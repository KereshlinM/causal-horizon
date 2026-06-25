import { useState } from "react";
import { api, EntityDetail, EntitySummary } from "../api";
import { formatHours, formatTime, urgencyColor, useAsync, useAsyncFn } from "../hooks";

function UrgencyGauge({ score }: { score: number }) {
  const color = urgencyColor(score);
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <svg viewBox="0 0 36 36" style={{ width: 64, height: 64, transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface-2)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${score} ${100 - score}`}
          strokeDashoffset="0"
          strokeLinecap="round"
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 13, fontWeight: 700, color,
      }}>
        {Math.round(score)}
      </div>
    </div>
  );
}

function EntityPanel({ externalId, onResolved }: { externalId: string; onResolved: () => void }) {
  const { data: entity, loading, refresh } = useAsync(() => api.entity(externalId), [externalId]);
  const { data: obsData } = useAsync(() => api.entityObservations(externalId), [externalId]);
  const [tab, setTab] = useState<"signals" | "alerts" | "observations">("signals");
  const [signal, setSignal] = useState("");
  const [value, setValue] = useState("");
  const outcome = useAsyncFn(api.recordOutcome);
  const observe = useAsyncFn(api.observe);

  if (loading) return <p className="muted" style={{ padding: 20 }}>Loading...</p>;
  if (!entity) return null;

  const ud = entity.urgency_detail;
  const timeLeft = entity.deadline_at
    ? Math.max(0, (new Date(entity.deadline_at).getTime() - Date.now()) / 3600000)
    : null;

  const handleObserve = async () => {
    if (!signal.trim() || value === "") return;
    const result = await observe.run(externalId, signal.trim(), parseFloat(value));
    if (result !== null) {
      setSignal("");
      setValue("");
      refresh();
    }
  };

  const handleOutcome = async (o: "positive" | "negative") => {
    if (!window.confirm(`Mark as ${o}?`)) return;
    const result = await outcome.run(externalId, o);
    if (result !== null) { onResolved(); refresh(); }
  };

  return (
    <div className="entity-panel">
      <div className="entity-panel-header">
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <UrgencyGauge score={entity.urgency_score} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{entity.label ?? entity.external_id}</div>
            {entity.label && <div className="muted" style={{ fontSize: 11 }}>{entity.external_id}</div>}
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {entity.entity_type}
              {timeLeft != null && (
                <span style={{ marginLeft: 8, color: urgencyColor(entity.urgency_score), fontWeight: 500 }}>
                  {formatHours(timeLeft)} remaining
                </span>
              )}
            </div>
          </div>
        </div>
        {entity.resolved_at == null && (
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => handleOutcome("positive")}>
              Resolved
            </button>
            <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => handleOutcome("negative")}>
              Failed
            </button>
          </div>
        )}
        {entity.resolved_at != null && (
          <span className={entity.outcome === "positive" ? "badge-ok" : "badge-warn"}>
            {entity.outcome}
          </span>
        )}
      </div>

      {/* Quick observe form */}
      {entity.resolved_at == null && (
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <input
            className="form-input"
            style={{ flex: 2 }}
            placeholder="signal name"
            value={signal}
            onChange={(e) => setSignal(e.target.value)}
          />
          <input
            className="form-input"
            style={{ flex: 1, maxWidth: 100 }}
            placeholder="value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            className="btn btn-primary"
            style={{ fontSize: 12 }}
            onClick={handleObserve}
            disabled={observe.loading || !signal.trim() || value === ""}
          >
            {observe.loading ? "..." : "Record"}
          </button>
        </div>
      )}

      <div className="tab-bar">
        {(["signals", "alerts", "observations"] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "signals" ? "Signals" : t === "alerts" ? `Alerts (${entity.alerts.length})` : "History"}
          </button>
        ))}
      </div>

      {tab === "signals" && (
        <div style={{ padding: 16 }}>
          {!ud || Object.keys(ud.signals).length === 0 ? (
            <p className="muted">No signal data yet. Record observations above.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 24, fontSize: 12, marginBottom: 14 }}>
                <div><span className="muted">Deadline pressure: </span><strong>{ud.deadline_score.toFixed(1)}</strong></div>
                <div><span className="muted">Signal pressure: </span><strong>{ud.signal_score.toFixed(1)}</strong></div>
                {ud.lead_time_h != null && (
                  <div><span className="muted">Lead time: </span><strong>{formatHours(ud.lead_time_h)}</strong></div>
                )}
              </div>
              {Object.entries(ud.signals).map(([name, sig]) => (
                <div key={name} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 500 }}>{name}</span>
                    <span className="muted">
                      value {sig.value} · z={sig.z_score > 0 ? "+" : ""}{sig.z_score} · w={sig.causal_weight}
                    </span>
                  </div>
                  <div style={{ background: "var(--surface-2)", borderRadius: 4, height: 5 }}>
                    <div style={{
                      width: `${Math.min(100, (sig.contribution / 4) * 100)}%`,
                      height: 5,
                      borderRadius: 4,
                      background: sig.z_score > 2 ? "#ef4444" : sig.z_score > 1 ? "#f97316" : "#4b5563",
                    }} />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "alerts" && (
        <div style={{ padding: 16 }}>
          {entity.alerts.length === 0 && <p className="muted">No alerts fired.</p>}
          {entity.alerts.map((a) => (
            <div key={a.id} className="session-row" style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: urgencyColor(a.urgency_score) }}>
                    {a.urgency_score.toFixed(0)}
                  </span>
                  <span className="muted"> / {a.severity}</span>
                </div>
                {a.lead_time_h != null && (
                  <div className="muted" style={{ fontSize: 11 }}>{formatHours(a.lead_time_h)} remaining at fire</div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: 11 }}>{formatTime(a.fired_at)}</div>
                {a.webhook_delivered && <span className="badge-ok" style={{ fontSize: 10, padding: "1px 5px" }}>delivered</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "observations" && (
        <div style={{ padding: 16 }}>
          {(obsData?.observations ?? []).length === 0 && <p className="muted">No observations yet.</p>}
          {(obsData?.observations ?? []).map((o) => (
            <div key={o.id} className="session-row" style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <span style={{ fontSize: 13 }}>{o.signal}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  {o.direction === "higher_is_worse" ? "higher worse" : "lower worse"}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{o.value}</div>
                <div className="muted" style={{ fontSize: 11 }}>{formatTime(o.observed_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegisterForm({ onCreated }: { onCreated: () => void }) {
  const [externalId, setExternalId] = useState("");
  const [entityType, setEntityType] = useState("generic");
  const [label, setLabel] = useState("");
  const [deadline, setDeadline] = useState("");
  const [windowH, setWindowH] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fn = useAsyncFn(api.registerEntity);

  const handleSubmit = async () => {
    if (!externalId.trim()) return;
    setError(null);
    const result = await fn.run({
      external_id: externalId.trim(),
      entity_type: entityType.trim() || "generic",
      label: label.trim() || undefined,
      deadline_at: deadline ? new Date(deadline).toISOString() : undefined,
      window_hours: windowH ? parseFloat(windowH) : undefined,
    });
    if (result !== null) {
      setExternalId(""); setLabel(""); setDeadline(""); setWindowH("");
      onCreated();
    } else {
      setError(fn.error);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3 style={{ marginTop: 0 }}>Register Entity</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label className="form-label">ID</label>
            <input className="form-input" placeholder="user-123" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Type</label>
            <input className="form-input" placeholder="trial_user" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Label (optional)</label>
          <input className="form-input" placeholder="Acme Corp trial" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label className="form-label">Deadline (optional)</label>
            <input className="form-input" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Window (hours)</label>
            <input className="form-input" type="number" placeholder="auto" value={windowH} onChange={(e) => setWindowH(e.target.value)} />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={fn.loading || !externalId.trim()}>
          {fn.loading ? "Registering..." : "Register"}
        </button>
      </div>
    </div>
  );
}

export default function Entities() {
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { data, loading, error, refresh } = useAsync(api.entities, []);
  const entities = data?.entities ?? [];

  return (
    <div className="users-layout">
      <div className="users-list">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Entities ({entities.length})</h2>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "+ New"}
          </button>
        </div>
        {showForm && (
          <div style={{ marginBottom: 12 }}>
            <RegisterForm onCreated={() => { setShowForm(false); refresh(); }} />
          </div>
        )}
        {loading && <p className="muted">Loading...</p>}
        {error && <div className="error">{error.detail}</div>}
        {entities.map((e) => {
          const timeLeft = e.deadline_at
            ? Math.max(0, (new Date(e.deadline_at).getTime() - Date.now()) / 3600000)
            : null;
          return (
            <div
              key={e.id}
              className={`user-row ${selected === e.external_id ? "selected" : ""}`}
              onClick={() => setSelected(e.external_id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{e.label ?? e.external_id}</div>
                <div style={{
                  fontSize: 12, fontWeight: 700,
                  color: urgencyColor(e.urgency_score),
                  minWidth: 28, textAlign: "right",
                }}>
                  {Math.round(e.urgency_score)}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {e.entity_type}
                {timeLeft != null && (
                  <span style={{ marginLeft: 6, color: urgencyColor(e.urgency_score) }}>
                    · {formatHours(timeLeft)} left
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!loading && entities.length === 0 && <p className="muted">No active entities.</p>}
      </div>
      <div className="users-detail">
        {selected ? (
          <EntityPanel externalId={selected} onResolved={refresh} />
        ) : (
          <div className="empty-detail">
            <p className="muted">Select an entity to view its causal urgency state.</p>
          </div>
        )}
      </div>
    </div>
  );
}
