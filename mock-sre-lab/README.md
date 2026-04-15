# Mock SRE Lab

This folder contains a local sandbox for testing an AI SRE agent against real telemetry signals:

- a FastAPI mock application with intentional failure modes
- a synthetic traffic generator
- Prometheus, Loki, Tempo, Grafana, Alloy, and GlitchTip

## Start

1. Copy `.env.example` to `.env`.
2. Start the stack:

```bash
docker compose up --build -d
```

3. Open the local tools:

- App: `http://localhost:8080`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
- Loki health: `http://localhost:3100/ready`
- Tempo: `http://localhost:3200`
- Alloy: `http://localhost:12345`
- GlitchTip: `http://localhost:8000`

## GlitchTip setup

GlitchTip is included, but a project DSN is not auto-provisioned. For full error tracking:

1. Open `http://localhost:8000`.
2. Create the first user, organization, team, and project.
3. Copy the project DSN into `GLITCHTIP_DSN` in `.env`.
4. Restart the app service:

```bash
docker compose up -d --build app
```

The app runs without a DSN; only Sentry-compatible error export is disabled until you add one.

## Fault injection

Available scenarios are defined in [scenarios/scenarios.json](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab/scenarios/scenarios.json).

Manual activation example:

```bash
curl -X POST http://localhost:8080/internal/faults/payment_timeout \
  -H 'content-type: application/json' \
  -d '{"enabled": true, "duration_seconds": 120, "source": "manual"}'
```

Health and metrics:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/metrics
```

## Endpoints

- `GET /api/v1/catalog/{sku}`
- `POST /api/v1/checkout`
- `GET /api/v1/reports/slow`
- `GET /healthz`
- `GET /metrics`
- `POST /internal/faults/{scenario}`

## Verification

Run the app tests:

```bash
docker compose run --rm app pytest tests -q
```

Smoke test the stack:

```bash
docker compose up --build -d
curl http://localhost:8080/api/v1/catalog/demo-sku
curl http://localhost:8080/api/v1/reports/slow
```
