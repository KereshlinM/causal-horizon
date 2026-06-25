# Causal Horizon

Know the last moment you can still act.

Most monitoring tells you when something has already gone wrong. Causal Horizon tells you when you are approaching the point where intervention stops working. It tracks entities moving toward irreversible outcomes, scores their urgency in real time, and fires a webhook at the last effective moment.

## The concept

Every situation has a **causal horizon** - the last point in time at which acting on a signal can still change the outcome. Miss it and the intervention is useless. Hit it too early and the signal is too weak to trust.

Causal Horizon models three things:

- **Deadline pressure** - how close is the entity to its causal window closing?
- **Signal pressure** - how alarming are current observations relative to historical baseline?
- **Causal weight** - at this lead time, how much does this signal actually predict the outcome?

These combine into a single **urgency score** (0-100). Webhooks fire when the score crosses a configurable threshold, giving you the widest possible intervention window.

## Urgency scoring

```
urgency = deadline_score (0-60) + signal_score (0-40)
```

**Deadline score** uses a curve that stays low when plenty of time remains and accelerates toward the deadline. An entity at 10% elapsed scores ~5. At 80% elapsed it scores ~50.

**Signal score** uses z-scores relative to each signal's global baseline, weighted by the signal's **causal weight** at the current lead time.

Causal weight follows a bell curve peaking at `1/λ` hours before the deadline:

```
weight(t) = A · t · e^(−λt) · λe
```

A signal with λ=0.04 peaks at ~25 hours lead time. Far from the deadline the signal is too noisy to trust. At the deadline it is too late to act. The peak is the action window.

## Decay curve learning

After enough resolved entities with recorded outcomes, call `POST /api/v1/signals/{name}/train`. The service groups historical observations by lead-time bucket, finds where alarming values most differentiated negative from positive outcomes, and fits λ and amplitude from that peak.

Without a fitted curve, causal weight defaults to 1.0 across all lead times. The urgency score is still useful - deadline pressure alone gives meaningful signal.

## Getting started

### With Docker

```bash
cp backend/.env.example backend/.env
docker compose up
```

API available at `http://localhost:8000`. Bootstrap your first API key:

```bash
# Any value works on first run (no keys exist yet)
curl -X POST http://localhost:8000/api/v1/keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: bootstrap" \
  -d '{"name": "my-key"}'
# Returns: {"key": "ch_...", ...}  -- save this
```

### Without Docker

```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Set DATABASE_URL in .env, then:
uvicorn app.main:app --reload

cd frontend
npm install && npm run dev
```

## Usage example

Track a trial user approaching their trial expiry:

```bash
KEY="ch_your_key"
BASE="http://localhost:8000"

# Register entity with a deadline
curl -X POST $BASE/api/v1/entities \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "external_id": "user-8821",
    "entity_type": "trial_user",
    "label": "Acme Corp",
    "deadline_at": "2026-07-10T00:00:00Z"
  }'

# Record signal observations over time
curl -X POST $BASE/api/v1/entities/user-8821/observe \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"signal": "days_since_last_login", "value": 5}'

curl -X POST $BASE/api/v1/entities/user-8821/observe \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"signal": "support_tickets_open", "value": 3}'

# Check urgency state
curl $BASE/api/v1/entities/user-8821 -H "X-API-Key: $KEY"
# Returns urgency_score, lead_time_h, per-signal breakdown

# Record outcome after trial ends (feeds decay curve training)
curl -X POST $BASE/api/v1/entities/user-8821/outcome \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"outcome": "negative"}'
```

## Webhooks

```bash
curl -X POST $BASE/api/v1/webhooks \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example.com/hooks/horizon",
    "secret": "signing-secret",
    "alert_threshold": 70
  }'
```

Requests are signed with `X-Horizon-Signature: sha256=<hmac>`.

**Payload:**

```json
{
  "event": "horizon.alert",
  "entity_id": "user-8821",
  "entity_type": "trial_user",
  "label": "Acme Corp",
  "urgency_score": 74.2,
  "severity": "high",
  "lead_time_h": 31.5,
  "deadline_at": "2026-07-10T00:00:00Z",
  "signals": {
    "days_since_last_login": {
      "value": 5,
      "z_score": 2.1,
      "causal_weight": 0.84,
      "contribution": 1.76
    }
  },
  "fired_at": "2026-07-08T16:30:00Z"
}
```

## Use cases

| Domain | Entity | Signals | Outcome |
|---|---|---|---|
| SaaS | Trial user | Login frequency, feature adoption, support tickets | Churned / converted |
| DevOps | Deployment | Error rate, p99 latency, memory trend | Rollback needed / stable |
| Incident response | Active incident | MTTR trend, responder count, escalations | Resolved / escalated |
| Finance | Credit account | Payment delays, balance trend, contact attempts | Default / current |
| Healthcare | Patient readmission | Vitals deviation, medication adherence | Readmitted / discharged |

## API reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/keys` | Create API key |
| `GET` | `/api/v1/keys` | List API keys |
| `DELETE` | `/api/v1/keys/{id}` | Revoke API key |
| `POST` | `/api/v1/entities` | Register entity |
| `GET` | `/api/v1/entities` | List active entities by urgency |
| `GET` | `/api/v1/entities/{id}` | Entity detail with urgency breakdown |
| `POST` | `/api/v1/entities/{id}/observe` | Record signal observation |
| `POST` | `/api/v1/entities/{id}/outcome` | Record resolved outcome |
| `GET` | `/api/v1/entities/{id}/observations` | Observation history |
| `POST` | `/api/v1/signals` | Define a signal |
| `GET` | `/api/v1/signals` | List signals |
| `POST` | `/api/v1/signals/{name}/train` | Fit decay curve from outcomes |
| `DELETE` | `/api/v1/signals/{name}` | Delete signal |
| `POST` | `/api/v1/webhooks` | Create webhook |
| `GET` | `/api/v1/webhooks` | List webhooks |
| `DELETE` | `/api/v1/webhooks/{id}` | Delete webhook |
| `GET` | `/api/v1/webhooks/{id}/deliveries` | Delivery history |
| `GET` | `/api/v1/dashboard/overview` | Aggregate stats and top entities |
