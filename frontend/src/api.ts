const getKey = () => localStorage.getItem("ch_api_key") ?? "";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getKey(),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = await res.json();
      const raw = b.detail;
      if (typeof raw === "string") detail = raw;
      else if (Array.isArray(raw)) detail = raw.map((e: any) => e.msg ?? JSON.stringify(e)).join("; ");
      else if (raw != null) detail = JSON.stringify(raw);
    } catch {}
    throw { status: res.status, detail };
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => req<{ status: string; version: string }>("/api/v1/health"),

  overview: () => req<OverviewData>("/api/v1/dashboard/overview"),

  entities: (params?: { entity_type?: string; active_only?: boolean; limit?: number }) => {
    const p = new URLSearchParams();
    if (params?.entity_type) p.set("entity_type", params.entity_type);
    if (params?.active_only !== undefined) p.set("active_only", String(params.active_only));
    if (params?.limit) p.set("limit", String(params.limit));
    return req<{ entities: EntitySummary[] }>(`/api/v1/entities?${p}`);
  },
  entity: (externalId: string) => req<EntityDetail>(`/api/v1/entities/${encodeURIComponent(externalId)}`),
  registerEntity: (body: RegisterEntityBody) =>
    req<EntitySummary>("/api/v1/entities", { method: "POST", body: JSON.stringify(body) }),
  observe: (externalId: string, signal: string, value: number) =>
    req<ObserveResponse>(`/api/v1/entities/${encodeURIComponent(externalId)}/observe`, {
      method: "POST",
      body: JSON.stringify({ signal, value }),
    }),
  recordOutcome: (externalId: string, outcome: "positive" | "negative") =>
    req<{ recorded: boolean; outcome: string }>(
      `//api/v1/entities/${encodeURIComponent(externalId)}/outcome`,
      { method: "POST", body: JSON.stringify({ outcome }) }
    ),
  entityObservations: (externalId: string) =>
    req<{ observations: ObservationRow[] }>(
      `/api/v1/entities/${encodeURIComponent(externalId)}/observations`
    ),

  signals: () => req<{ signals: SignalDef[] }>("/api/v1/signals"),
  createSignal: (name: string, description: string, direction: string) =>
    req<SignalDef>("/api/v1/signals", { method: "POST", body: JSON.stringify({ name, description, direction }) }),
  trainSignal: (name: string) =>
    req<{ trained: boolean; reason?: string; decay_params?: DecayParams }>(
      `/api/v1/signals/${encodeURIComponent(name)}/train`,
      { method: "POST" }
    ),
  deleteSignal: (name: string) =>
    req(`/api/v1/signals/${encodeURIComponent(name)}`, { method: "DELETE" }),

  webhooks: () => req<{ webhooks: WebhookSummary[] }>("/api/v1/webhooks"),
  createWebhook: (url: string, secret: string | undefined, alert_threshold: number, events: string[]) =>
    req("/api/v1/webhooks", { method: "POST", body: JSON.stringify({ url, secret, alert_threshold, events }) }),
  deleteWebhook: (id: number) => req(`/api/v1/webhooks/${id}`, { method: "DELETE" }),
  webhookDeliveries: (id: number) => req<{ deliveries: DeliveryRow[] }>(`/api/v1/webhooks/${id}/deliveries`),

  createKey: (name: string) =>
    req<{ id: number; key: string; prefix: string; name: string }>("/api/v1/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
};

export interface OverviewData {
  entities: { total: number; active: number; resolved: number };
  urgency_distribution: { critical: number; high: number; medium: number; low: number };
  alerts: { total: number };
  signals: { total: number };
  top_entities: TopEntity[];
  recent_alerts: RecentAlert[];
}

export interface TopEntity {
  external_id: string;
  entity_type: string;
  label: string | null;
  urgency_score: number;
  deadline_at: string | null;
  window_hours: number | null;
}

export interface RecentAlert {
  id: number;
  entity_id: string;
  entity_type: string;
  urgency_score: number;
  severity: string;
  lead_time_h: number | null;
  fired_at: string;
}

export interface EntitySummary {
  id: number;
  external_id: string;
  entity_type: string;
  label: string | null;
  deadline_at: string | null;
  window_hours: number | null;
  urgency_score: number;
  urgency_updated_at: string | null;
  outcome: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface UrgencyDetail {
  urgency_score: number;
  deadline_score: number;
  signal_score: number;
  severity: string;
  lead_time_h: number | null;
  signals: Record<string, {
    value: number;
    z_score: number;
    causal_weight: number;
    contribution: number;
    direction: string;
  }>;
}

export interface AlertRow {
  id: number;
  urgency_score: number;
  severity: string;
  lead_time_h: number | null;
  fired_at: string;
  webhook_delivered: boolean;
}

export interface EntityDetail extends EntitySummary {
  urgency_detail: UrgencyDetail | null;
  alerts: AlertRow[];
}

export interface ObserveResponse {
  observed: boolean;
  urgency_score: number;
  severity: string;
  lead_time_h: number | null;
}

export interface ObservationRow {
  id: number;
  signal: string;
  direction: string;
  value: number;
  observed_at: string;
}

export interface DecayParams {
  lambda: number;
  amplitude: number;
  peak_lead_time_h: number;
  n_samples: number;
}

export interface SignalDef {
  id: number;
  name: string;
  description: string;
  direction: string;
  decay_params: DecayParams | null;
  created_at: string;
}

export interface WebhookSummary {
  id: number;
  url: string;
  events: string[];
  alert_threshold: number;
  last_delivery_at: string | null;
  last_delivery_status: number | null;
}

export interface DeliveryRow {
  id: number;
  attempted_at: string;
  status_code: number | null;
  success: boolean;
  attempt: number;
  error: string | null;
}

export interface RegisterEntityBody {
  external_id: string;
  entity_type?: string;
  label?: string;
  deadline_at?: string;
  window_hours?: number;
}
