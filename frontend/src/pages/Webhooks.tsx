import { useState } from "react";
import { api, WebhookSummary } from "../api";
import { formatTime, useAsync, useAsyncFn } from "../hooks";

function DeliveriesPanel({ id }: { id: number }) {
  const { data, loading } = useAsync(() => api.webhookDeliveries(id), [id]);
  if (loading) return <p className="muted" style={{ padding: "8px 0" }}>Loading...</p>;
  const deliveries = data?.deliveries ?? [];
  if (deliveries.length === 0) return <p className="muted" style={{ padding: "8px 0" }}>No deliveries yet.</p>;
  return (
    <div style={{ marginTop: 10 }}>
      {deliveries.map((d) => (
        <div key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: d.success ? "var(--ok)" : "var(--error)", fontWeight: 600 }}>
              {d.success ? "OK" : "FAIL"}
            </span>
            {d.status_code != null && <span className="muted">HTTP {d.status_code}</span>}
            {d.attempt > 1 && <span className="muted">attempt {d.attempt}</span>}
            {d.error && <span style={{ color: "var(--error)" }}>{d.error}</span>}
          </div>
          <span className="muted">{formatTime(d.attempted_at)}</span>
        </div>
      ))}
    </div>
  );
}

function WebhookCard({ wh, onDelete }: { wh: WebhookSummary; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const deleteFn = useAsyncFn(api.deleteWebhook);

  const handleDelete = async () => {
    if (!window.confirm(`Delete webhook for ${wh.url}?`)) return;
    const result = await deleteFn.run(wh.id);
    if (result !== null) onDelete();
  };

  return (
    <div className="webhook-card">
      <div className="webhook-card-header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wh.url}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {wh.events.map((e) => <span key={e} className="signal-chip">{e}</span>)}
            <span className="signal-chip">threshold: {wh.alert_threshold}</span>
          </div>
          {wh.last_delivery_at && (
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Last: {formatTime(wh.last_delivery_at)}
              {wh.last_delivery_status != null && (
                <span style={{ marginLeft: 6, color: wh.last_delivery_status < 300 ? "var(--ok)" : "var(--error)" }}>
                  HTTP {wh.last_delivery_status}
                </span>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setExpanded((e) => !e)}>
            {expanded ? "Hide" : "Deliveries"}
          </button>
          <button className="btn btn-danger" style={{ fontSize: 12 }} onClick={handleDelete} disabled={deleteFn.loading}>
            {deleteFn.loading ? "..." : "Delete"}
          </button>
        </div>
      </div>
      {expanded && <DeliveriesPanel id={wh.id} />}
    </div>
  );
}

function AddWebhookForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [threshold, setThreshold] = useState("70");
  const [error, setError] = useState<string | null>(null);
  const fn = useAsyncFn(api.createWebhook);

  const handleSubmit = async () => {
    if (!url.trim()) return;
    setError(null);
    const result = await fn.run(
      url.trim(),
      secret.trim() || undefined,
      parseFloat(threshold) || 70,
      ["horizon.alert"],
    );
    if (result !== null) { setUrl(""); setSecret(""); onCreated(); }
    else setError(fn.error);
  };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginTop: 0 }}>Add Webhook</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label className="form-label">Endpoint URL</label>
          <input className="form-input" placeholder="https://example.com/hooks/horizon" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 2 }}>
            <label className="form-label">Secret (HMAC signing, optional)</label>
            <input className="form-input" type="password" placeholder="signing-secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="form-label">Alert threshold (0-100)</label>
            <input className="form-input" type="number" min="0" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={fn.loading || !url.trim()}>
          {fn.loading ? "Adding..." : "Add Webhook"}
        </button>
      </div>
    </div>
  );
}

export default function Webhooks() {
  const { data, loading, error, refresh } = useAsync(api.webhooks, []);
  const webhooks = data?.webhooks ?? [];

  return (
    <>
      <h1 className="page-title">Webhooks</h1>
      <AddWebhookForm onCreated={refresh} />
      {loading && <p className="muted">Loading...</p>}
      {error && <div className="error">{error.detail}</div>}
      {webhooks.map((wh) => <WebhookCard key={wh.id} wh={wh} onDelete={refresh} />)}
      {!loading && webhooks.length === 0 && <p className="muted">No webhooks configured.</p>}
    </>
  );
}
