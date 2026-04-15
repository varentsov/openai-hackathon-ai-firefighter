# Local SRE Sandbox Mock App

## Summary
- Create a new top-level folder at `mock-sre-lab` that contains one FastAPI service, one synthetic traffic generator, and a local observability stack managed by Docker Compose.
- Use `Python + FastAPI` for the app, `Prometheus` for metrics, `Grafana` for dashboards, `Loki` for logs, `Tempo` for traces/APM, `Grafana Alloy` as the collector, and `GlitchTip` as the local Sentry-compatible error tracker.
- Keep the business topology to one app, but make failures rich and realistic: latency spikes, dependency timeouts, exception bursts, noisy logs, and slow resource growth.
- Make the environment continuously useful for an AI SRE agent by adding a built-in `loadgen` service that produces normal traffic plus scheduled incident windows.

## Implementation Changes
- Add `app/` with a FastAPI service exposing 3 business endpoints:
  - `GET /api/v1/catalog/{sku}` for read-heavy traffic with cache-miss and fake DB-latency behavior.
  - `POST /api/v1/checkout` for write-heavy traffic with retry logs, dependency failures, and exception paths.
  - `GET /api/v1/reports/slow` for intentionally expensive requests that drive latency and CPU usage.
- Add non-business endpoints:
  - `GET /healthz` for liveness.
  - `GET /metrics` for Prometheus scraping.
  - `POST /internal/faults/{scenario}` for deterministic fault injection during tests.
- Instrument the app with:
  - Structured JSON logs to `stdout` including `request_id`, `trace_id`, `span_id`, `scenario`, `route`, `status_code`, `latency_ms`, and exception fields.
  - Prometheus metrics using the official Python client and an ASGI metrics endpoint.
  - OpenTelemetry tracing for FastAPI and outbound calls; export via OTLP to Alloy, then to Tempo.
  - `sentry-sdk` pointed at local GlitchTip for uncaught exceptions and selected handled errors.
- Add `loadgen/` as a separate container that continuously calls the 3 endpoints with weighted traffic; default mix should favor `catalog`, keep `checkout` moderate, and hit `reports/slow` occasionally.
- Add deterministic failure modes:
  - `payment_timeout`: downstream timeout burst causing 502/504s and retry logs.
  - `db_pool_exhaustion`: queue growth, slower requests, and partial failures.
  - `memory_leak`: slow RSS growth to create infra-style symptoms over time.
  - `error_burst`: repeated exceptions that appear in logs, traces, metrics, and GlitchTip.
- Add `infra/` with Docker Compose and configs for:
  - `prometheus` scraping the app and collector targets.
  - `grafana` with preloaded dashboards and data sources.
  - `loki` for logs.
  - `tempo` for traces.
  - `alloy` to receive OTLP and ship logs/traces.
  - `glitchtip` in minimal local mode.
- Add `dashboards/` with at least 3 Grafana dashboards:
  - Service overview: RPS, error rate, p50/p95/p99 latency, active fault scenario.
  - Logs and errors: error-count spikes, top exception types, route-level failure views.
  - Traces/APM: slowest spans, error traces, dependency timeout traces.

## Public Interfaces And Config
- The mock app contract should be explicit and stable enough for the AI SRE agent to target:
  - Business API endpoints listed above.
  - Internal control endpoint `POST /internal/faults/{scenario}` with accepted scenario names matching the 4 fault modes.
  - Telemetry endpoint `GET /metrics`.
- Define environment variables in a single `.env.example`:
  - `APP_PORT`, `LOG_LEVEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `GLITCHTIP_DSN`, `FAULT_SCHEDULE`, `LOADGEN_ENABLED`, `LOADGEN_RPS`.
- Persist scenario definitions in a simple config file under `scenarios/` so incidents are reproducible and not hardcoded.
- Use standard default ports unless they conflict locally: app `8080`, Grafana `3000`, Prometheus `9090`, Loki `3100`, Tempo OTLP/UI defaults via Compose, GlitchTip on its exposed HTTP port.

## Test Plan
- Bring up the stack and verify the app, Grafana, Prometheus, Loki, Tempo, and GlitchTip are all reachable.
- Confirm normal traffic produces:
  - request logs with correlation fields,
  - Prometheus counters/histograms,
  - Tempo traces for each endpoint,
  - zero or near-zero baseline exceptions in GlitchTip.
- Trigger each fault scenario manually through `POST /internal/faults/{scenario}` and verify the expected symptom pattern appears across logs, metrics, traces, and error tracking.
- Verify the scheduled traffic mode creates recurring incidents without manual intervention so the AI SRE agent always has active signals to inspect.
- Restart the app container and confirm the observability pipeline recovers cleanly and resumes data flow.
- Acceptance criteria for v1:
  - every incident is visible in at least 3 signal types,
  - at least one incident creates a clear “infra-like” symptom without an immediate app exception,
  - at least one incident creates a clear GlitchTip issue with correlated trace/log context.

## Assumptions And Defaults
- Build everything inside `mock-sre-lab`; do not mix it into future AI SRE agent code yet.
- Use `GlitchTip` instead of self-hosted Sentry for v1 because it is Sentry-compatible and much lighter to run locally.
- Use `Grafana Alloy` instead of `Promtail`; Grafana documents that Promtail reached end-of-life on March 2, 2026, so Alloy is the safer default for a new local stack.
- Prefer one app plus helper observability services over a multi-business-service topology for the first iteration; add a second downstream app only after the single-service failure lab is stable.
- Docker CLI is installed in this environment, but the Docker daemon was not reachable during planning; implementation should assume Docker Desktop or the daemon must be running first.

## References
- [OpenTelemetry Python docs](https://opentelemetry.io/docs/languages/python/instrumentation/)
- [Prometheus Python client docs](https://prometheus.github.io/client_python/exporting/http/asgi/)
- [Grafana Alloy introduction](https://grafana.com/docs/alloy/latest/introduction/)
- [Grafana Loki local install docs](https://grafana.com/docs/loki/latest/setup/install/docker/)
- [Grafana Tempo local Docker Compose docs](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/deploy/locally/docker-compose/)
- [GlitchTip installation docs](https://glitchtip.com/documentation/install)
- [GlitchTip Python SDK docs](https://glitchtip.com/sdkdocs/python)
