import { api, TopEntity } from "../api";
import { formatHours, formatTime, urgencyColor, useAsync } from "../hooks";

const SEV_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#f59e0b",
  low: "#84cc16",
};

function UrgencyBar({ score }: { score: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            borderRadius: 4,
            background: urgencyColor(score),
            transition: "width 0.4s",
          }}
        />
      </div>
      <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function EntityRow({ e }: { e: TopEntity }) {
  const timeLeft = e.deadline_at
    ? Math.max(0, (new Date(e.deadline_at).getTime() - Date.now()) / 3600000)
    : null;

  return (
    <div className="event-row">
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{e.label ?? e.external_id}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {e.entity_type}
          {timeLeft != null && (
            <span style={{ marginLeft: 8, color: urgencyColor(e.urgency_score) }}>
              {formatHours(timeLeft)} left
            </span>
          )}
        </div>
      </div>
      <div style={{ minWidth: 160 }}>
        <UrgencyBar score={e.urgency_score} />
      </div>
    </div>
  );
}

export default function Overview() {
  const { data, loading, error, refresh } = useAsync(api.overview, []);

  if (loading) return <p className="muted">Loading...</p>;
  if (error) return <div className="error">{error.detail}</div>;
  if (!data) return null;

  const dist = data.urgency_distribution;
  const totalActive = data.entities.active;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Overview</h1>
        <button className="btn btn-secondary" onClick={refresh} style={{ fontSize: 12 }}>Refresh</button>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Active Entities</div>
          <div className="stat-value">{data.entities.active}</div>
          <div className="stat-sub">{data.entities.resolved} resolved</div>
        </div>
        <div className="stat-card" style={{ borderColor: dist.critical > 0 ? "rgba(239,68,68,0.4)" : undefined }}>
          <div className="stat-label">Critical</div>
          <div className="stat-value" style={{ color: dist.critical > 0 ? "#ef4444" : undefined }}>{dist.critical}</div>
          <div className="stat-sub">urgency &ge; 90</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">High</div>
          <div className="stat-value" style={{ color: dist.high > 0 ? "#f97316" : undefined }}>{dist.high}</div>
          <div className="stat-sub">urgency 70-89</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Alerts Fired</div>
          <div className="stat-value">{data.alerts.total}</div>
          <div className="stat-sub">{data.signals.total} signals tracked</div>
        </div>
      </div>

      {totalActive > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3>Urgency Distribution</h3>
          {(["critical", "high", "medium", "low"] as const).map((sev) => {
            const count = dist[sev];
            const pct = totalActive > 0 ? (count / totalActive) * 100 : 0;
            return (
              <div key={sev} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: SEV_COLOR[sev], textTransform: "capitalize", fontWeight: 500 }}>{sev}</span>
                  <span className="muted">{count} ({pct.toFixed(0)}%)</span>
                </div>
                <div style={{ background: "var(--surface-2)", borderRadius: 4, height: 6 }}>
                  <div style={{ width: `${pct}%`, height: 6, borderRadius: 4, background: SEV_COLOR[sev] }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h3>Most Urgent</h3>
          {data.top_entities.length === 0 && <p className="muted">No active entities.</p>}
          {data.top_entities.map((e) => <EntityRow key={e.external_id} e={e} />)}
        </div>
        <div className="card">
          <h3>Recent Alerts</h3>
          {data.recent_alerts.length === 0 && <p className="muted">No alerts fired yet.</p>}
          {data.recent_alerts.map((a) => (
            <div key={a.id} className="event-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{a.entity_id}</div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {a.entity_type}
                  {a.lead_time_h != null && ` · ${formatHours(a.lead_time_h)} remaining at alert`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: SEV_COLOR[a.severity] }}>
                  {a.urgency_score.toFixed(0)} / {a.severity}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>{formatTime(a.fired_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
