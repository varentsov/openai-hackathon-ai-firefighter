# Mock SRE Lab

This folder contains a local sandbox for testing an AI SRE agent against real telemetry signals:

- a FastAPI mock application with intentional failure modes
- a synthetic traffic generator
- Prometheus, Loki, Tempo, Grafana, Alloy, and GlitchTip

The agent-facing integration contract is documented in [SRE_AGENT_INTEGRATION.md](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab/SRE_AGENT_INTEGRATION.md).

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

GlitchTip is auto-bootstrapped on startup for local use. The bootstrap command creates:

- user: `test@example.com`
- password: `admin_pass`
- org: `org`
- team: `team`
- project: `project`
- API token and DSNs in the shared runtime env file: `glitchtip.env`

The app automatically loads the generated internal project DSN if `GLITCHTIP_DSN` is blank in `.env`. The bootstrap file contains:

- `GLITCHTIP_DSN` for container-to-container delivery (`glitchtip-web:8000`)
- `GLITCHTIP_PUBLIC_DSN` for local browser/API references (`localhost:8000`)
- `GLITCHTIP_API_TOKEN` for GlitchTip API access during verification

If you want to override the local auto-generated DSN, set `GLITCHTIP_DSN` explicitly in `.env` and restart the app.

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
