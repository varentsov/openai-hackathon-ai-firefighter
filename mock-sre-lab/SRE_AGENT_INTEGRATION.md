# SRE Agent Integration Guide

This document defines how an AI SRE agent should connect to the local mock lab, what signals are available, and how to keep the lab producing live telemetry for debugging exercises.

## Goal

The mock lab is intended to give an SRE agent a realistic local target with:

- application logs
- Prometheus metrics
- distributed traces via Tempo
- error tracking via GlitchTip
- controllable fault injection
- continuous background traffic from `loadgen`

The agent should treat this folder as a self-contained incident sandbox, not as production infrastructure.

## Stack Topology

The runtime is defined in [compose.yaml](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab/compose.yaml).

Services exposed on localhost:

- App: `http://localhost:8080`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`
- Loki: `http://localhost:3100`
- Tempo: `http://localhost:3200`
- Alloy: `http://localhost:12345`
- GlitchTip: `http://localhost:8000`

Internal service names used inside Docker:

- app: `http://app:8080`
- alloy OTLP gRPC: `http://alloy:4317`
- glitchtip web: `http://glitchtip-web:8000`

## Recommended Agent Tools

If the SRE agent uses tool calling, expose at least these tool classes:

1. `http_get`
   Use for Prometheus, Loki, Tempo, GlitchTip, app health, and metrics endpoints.

2. `http_post`
   Use for manual fault injection and write-heavy app endpoints such as checkout.

3. `shell_exec`
   Use for Docker lifecycle, container logs, container env inspection, and retrieving the GlitchTip API token.

4. `json_parse`
   Use to parse responses from Prometheus, Loki, Tempo, and GlitchTip APIs.

5. `time_range`
   Optional but useful for building Loki and trace queries around recent incidents.

Without `shell_exec`, the agent loses container inspection and GlitchTip bootstrap token discovery. That is a material limitation.

## What The Agent Can Observe

### App API

Business endpoints:

- `GET /api/v1/catalog/{sku}`
- `POST /api/v1/checkout`
- `GET /api/v1/reports/slow`

Operational endpoints:

- `GET /healthz`
- `GET /metrics`
- `POST /internal/faults/{scenario}`

### Logs

The app emits structured JSON logs to stdout. Alloy tails Docker logs and ships them to Loki.

Important log fields:

- `timestamp`
- `level`
- `logger`
- `message`
- `request_id`
- `trace_id`
- `span_id`
- `route`
- `scenario`
- `event`
- `status_code`
- `latency_ms`
- `exception_type`
- `exception_message`

Primary correlation keys:

- `request_id` for request-level debugging
- `trace_id` for cross-linking logs to Tempo traces
- `scenario` for identifying active injected faults

### Metrics

Prometheus scrapes the app from `/metrics`.

Important metric names from [metrics.py](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab/app/src/metrics.py):

- `mock_app_requests_total`
- `mock_app_request_duration_seconds`
- `mock_app_fault_active`
- `mock_app_exceptions_total`
- `mock_app_db_pool_wait_seconds`
- `mock_app_db_pool_rejections_total`
- `mock_app_process_resident_memory_bytes`
- `mock_app_active_requests`

### Traces

OpenTelemetry spans are exported from the app to Alloy and stored in Tempo.

Important spans:

- request root spans like `GET /api/v1/catalog/sku-123`
- `db.query`
- `payment.gateway`
- `checkout.validate`
- `reports.aggregate`
- `fault.error_burst`

### Error Tracking

The app sends exceptions to GlitchTip using the auto-generated local DSN.

The GlitchTip bootstrap creates:

- org: `org`
- project: `project`
- user: `test@example.com`
- password: `admin_pass`

The GlitchTip API token is written into the shared bootstrap env file.

## How The Agent Connects To Each Signal

### 1. App Health And Business Endpoints

Example requests:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/catalog/demo-sku
curl -X POST http://localhost:8080/api/v1/checkout \
  -H 'content-type: application/json' \
  -d '{"order_id":"ord-1001","amount":42.0}'
curl http://localhost:8080/api/v1/reports/slow
```

Use these for black-box validation and to create targeted traffic during investigations.

### 2. Prometheus

Base URL:

- `http://localhost:9090`

Primary API:

- `GET /api/v1/query`

Example queries:

```bash
curl -sS 'http://localhost:9090/api/v1/query?query=mock_app_fault_active'
curl -sS 'http://localhost:9090/api/v1/query?query=mock_app_exceptions_total'
curl -sS 'http://localhost:9090/api/v1/query?query=rate(mock_app_requests_total[5m])'
curl -sS 'http://localhost:9090/api/v1/query?query=histogram_quantile(0.95,sum(rate(mock_app_request_duration_seconds_bucket[5m])) by (le,route))'
curl -sS 'http://localhost:9090/api/v1/query?query=mock_app_process_resident_memory_bytes'
```

Recommended agent prompts over Prometheus:

- current fault flags
- error volume by exception type
- latency percentiles by route
- DB pool rejection spikes
- active request pressure
- RSS growth during `memory_leak`

### 3. Loki

Base URL:

- `http://localhost:3100`

Primary API:

- `GET /loki/api/v1/query_range`

The log label `service_name` for the app is `app`.

Example queries:

```bash
START=$(python3 - <<'PY'
import time
print(int((time.time() - 900) * 1e9))
PY
)
END=$(python3 - <<'PY'
import time
print(int(time.time() * 1e9))
PY
)

curl -sG \
  --data-urlencode 'query={service_name="app"} |= "request_failed"' \
  --data-urlencode "start=$START" \
  --data-urlencode "end=$END" \
  --data-urlencode 'limit=20' \
  http://localhost:3100/loki/api/v1/query_range
```

Useful Loki filters:

- `|= "request_failed"`
- `|= "checkout_payment_failed"`
- `|= "payment_timeout"`
- `|= "fault_activated"`
- `|= "fault_deactivated"`

Useful label filters:

- `{service_name="app"}`
- `{service_name="app", level="ERROR"}`
- `{service_name="app", exception_type="RuntimeError"}`

### 4. Tempo

Base URL:

- `http://localhost:3200`

Primary API:

- `GET /api/search`

Example:

```bash
curl -sS 'http://localhost:3200/api/search?limit=10'
```

The response includes:

- `traceID`
- `rootServiceName`
- `rootTraceName`
- `durationMs`

The agent should use the `trace_id` from logs when available, then pivot into Tempo for slow spans and exception context.

### 5. GlitchTip

Base URL:

- `http://localhost:8000`

Primary API:

- `GET /api/0/projects/org/project/issues/`

Get the API token:

```bash
docker run --rm \
  -v mock-sre-lab_glitchtip-bootstrap-data:/data \
  alpine sh -lc "grep GLITCHTIP_API_TOKEN /data/glitchtip.env | cut -d= -f2"
```

List issues:

```bash
TOKEN=$(docker run --rm \
  -v mock-sre-lab_glitchtip-bootstrap-data:/data \
  alpine sh -lc "grep GLITCHTIP_API_TOKEN /data/glitchtip.env | cut -d= -f2")

curl -sS \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/0/projects/org/project/issues/
```

The agent should use GlitchTip for:

- grouped application exceptions
- exception titles and counts
- confirming that a fault is visible in error tracking

### 6. Docker And Runtime Inspection

Essential shell commands:

```bash
docker compose -f mock-sre-lab/compose.yaml ps
docker compose -f mock-sre-lab/compose.yaml logs app --tail=200
docker compose -f mock-sre-lab/compose.yaml logs loadgen --tail=200
docker compose -f mock-sre-lab/compose.yaml restart app
docker compose -f mock-sre-lab/compose.yaml up -d --build
```

Use Docker inspection when the agent needs:

- container status
- startup failures
- live stdout logs before they appear in dashboards
- restarts after config changes

## How To Run The Lab

From [mock-sre-lab](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab):

```bash
cp .env.example .env
docker compose up -d --build
```

Basic health checks:

```bash
curl http://localhost:8080/healthz
curl -I http://localhost:8080/metrics
curl http://localhost:9090/-/healthy
curl http://localhost:3100/ready
curl http://localhost:3200/ready
curl http://localhost:3000/api/health
```

Run tests:

```bash
docker compose run --rm app pytest tests -q
```

## How Real-Time Metrics Are Produced

Real-time signals come from two sources:

1. Continuous traffic from `loadgen`
2. Manual fault injection through `/internal/faults/{scenario}`

### Continuous Traffic

The load generator:

- runs automatically when `LOADGEN_ENABLED=true`
- defaults to `LOADGEN_RPS=2.5`
- sends a weighted mix of catalog, checkout, and slow-report requests
- activates scheduled faults defined in [scenarios.json](/Users/nikon/Workspace/Local/openai-hackathon-ai-firefighter/mock-sre-lab/scenarios/scenarios.json)

Default schedule:

- `payment_timeout`
- `db_pool_exhaustion`
- `error_burst`
- `memory_leak`

To make the lab noisier, raise RPS in `.env`:

```bash
LOADGEN_RPS=10
docker compose up -d --build loadgen
```

### Manual Fault Injection

Activate a fault:

```bash
curl -X POST http://localhost:8080/internal/faults/payment_timeout \
  -H 'content-type: application/json' \
  -d '{"enabled": true, "duration_seconds": 120, "source": "manual"}'
```

Deactivate a fault:

```bash
curl -X POST http://localhost:8080/internal/faults/payment_timeout \
  -H 'content-type: application/json' \
  -d '{"enabled": false, "source": "manual"}'
```

Available scenarios:

- `payment_timeout`
- `db_pool_exhaustion`
- `memory_leak`
- `error_burst`

Expected symptoms:

- `payment_timeout`: retries, warning logs, `504`, GlitchTip issues, checkout trace failures
- `db_pool_exhaustion`: elevated latency, `503`, DB pool rejection metrics, slow traces
- `memory_leak`: rising `mock_app_process_resident_memory_bytes`
- `error_burst`: repeated `500`, structured error logs, GlitchTip issues, fault spans

## Suggested Agent Workflow

When an incident is suspected, the agent should follow this order:

1. Check `healthz` and container status.
2. Query Prometheus for active faults, error counters, latency, and memory.
3. Query Loki for recent `request_failed`, `checkout_payment_failed`, and `fault_activated` events.
4. Pivot from `trace_id` in logs into Tempo to inspect slow spans and failure spans.
5. Query GlitchTip to confirm grouped application exceptions.
6. Use the fault control endpoint to reproduce or stop a scenario if needed.

This order matters. Metrics tell the agent that something is wrong, logs explain the local symptoms, traces show execution shape, and GlitchTip confirms exception grouping.

## Minimum Agent Contract

If you want a strict external contract for the SRE AI agent, expose these capabilities:

- read HTTP JSON/text from localhost services
- write HTTP POSTs to the app fault endpoint
- run read-only Docker and shell inspection commands
- parse structured JSON logs and API payloads
- maintain recent time windows for Loki and Prometheus queries

That is enough for the agent to investigate live incidents in this lab without direct code access.
