from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode
from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest

from .config import settings
from .logging_setup import configure_logging, request_id_var, route_var, scenario_var
from .metrics import ACTIVE_REQUESTS, EXCEPTIONS_TOTAL, REQUEST_DURATION_SECONDS, REQUESTS_TOTAL
from .scenario_manager import ScenarioManager


def configure_tracing() -> None:
    provider = TracerProvider(resource=Resource.create({"service.name": settings.service_name}))
    exporter = OTLPSpanExporter(endpoint=settings.otlp_endpoint, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)


logger = configure_logging(settings.log_level)
configure_tracing()
tracer = trace.get_tracer(settings.service_name)

if settings.glitchtip_dsn:
    sentry_sdk.init(
        dsn=settings.glitchtip_dsn,
        traces_sample_rate=0.0,
        environment="local",
    )


manager = ScenarioManager(settings.scenario_file, logger=logger, db_pool_size=settings.db_pool_size)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(manager.periodic_housekeeping())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):  # type: ignore[name-defined]
            await task


def create_app() -> FastAPI:
    application = FastAPI(
        title="mock-sre-app",
        version="0.1.0",
        description="A failure-prone mock app for SRE agent debugging exercises.",
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def request_observability(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        start = time.perf_counter()

        request_id_token = request_id_var.set(request_id)
        route_token = route_var.set(request.url.path)
        scenario_token = scenario_var.set(manager.active_faults_csv())
        ACTIVE_REQUESTS.inc()

        with tracer.start_as_current_span(f"{request.method} {request.url.path}") as span:
            span.set_attribute("http.method", request.method)
            span.set_attribute("http.target", request.url.path)
            span.set_attribute("fault.scenarios", manager.active_faults_csv())

            try:
                response = await call_next(request)
                status_code = response.status_code
            except Exception as exc:  # noqa: BLE001
                sentry_sdk.capture_exception(exc)
                EXCEPTIONS_TOTAL.labels(scenario=manager.active_faults_csv(), exception_type=type(exc).__name__).inc()
                logger.exception("request_failed", extra={"event": "request_failed"})
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR))
                status_code = 500
                response = JSONResponse(
                    status_code=500,
                    content={"detail": "internal server error", "request_id": request_id},
                )

            route_template = request.scope.get("route").path if request.scope.get("route") else request.url.path
            route_var.set(route_template)
            duration = time.perf_counter() - start

            REQUESTS_TOTAL.labels(
                method=request.method,
                route=route_template,
                status_code=str(status_code),
            ).inc()
            REQUEST_DURATION_SECONDS.labels(method=request.method, route=route_template).observe(duration)

            span.set_attribute("http.route", route_template)
            span.set_attribute("http.status_code", status_code)
            span.set_attribute("http.response_time_ms", round(duration * 1000, 2))

            response.headers["x-request-id"] = request_id
            response.headers["x-trace-id"] = format(span.get_span_context().trace_id, "032x")
            logger.info(
                "request_complete",
                extra={
                    "event": "request_complete",
                    "method": request.method,
                    "route": route_template,
                    "status_code": status_code,
                    "latency_ms": round(duration * 1000, 2),
                    "active_faults": manager.active_faults(),
                },
            )

        ACTIVE_REQUESTS.dec()
        scenario_var.reset(scenario_token)
        route_var.reset(route_token)
        request_id_var.reset(request_id_token)
        return response

    @application.get("/healthz")
    async def healthz() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": settings.service_name,
            "active_faults": manager.active_faults(),
        }

    @application.get("/metrics")
    async def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @application.get("/api/v1/dashboard/summary")
    async def dashboard_summary() -> dict[str, Any]:
        route_totals: dict[str, dict[str, float | dict[str, float]]] = {}
        exception_totals: dict[str, float] = defaultdict(float)
        fault_states: dict[str, bool] = {}
        gauges: dict[str, float] = {
            "active_requests": 0.0,
            "resident_memory_bytes": 0.0,
            "db_pool_rejections_total": 0.0,
        }

        request_counts: dict[str, float] = defaultdict(float)
        request_errors: dict[str, float] = defaultdict(float)
        request_statuses: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
        duration_sum: dict[str, float] = defaultdict(float)
        duration_count: dict[str, float] = defaultdict(float)

        for metric in REGISTRY.collect():
            for sample in metric.samples:
                sample_name = sample.name
                labels = sample.labels
                value = float(sample.value)

                if sample_name == "mock_app_requests_total":
                    route = labels.get("route", "unknown")
                    status_code = labels.get("status_code", "unknown")
                    request_counts[route] += value
                    request_statuses[route][status_code] += value
                    if status_code.startswith(("4", "5")):
                        request_errors[route] += value
                elif sample_name == "mock_app_request_duration_seconds_sum":
                    duration_sum[labels.get("route", "unknown")] += value
                elif sample_name == "mock_app_request_duration_seconds_count":
                    duration_count[labels.get("route", "unknown")] += value
                elif sample_name == "mock_app_exceptions_total":
                    exception_type = labels.get("exception_type", "Exception")
                    exception_totals[exception_type] += value
                elif sample_name == "mock_app_fault_active":
                    fault_states[labels.get("scenario", "unknown")] = bool(value)
                elif sample_name == "mock_app_active_requests":
                    gauges["active_requests"] = value
                elif sample_name == "mock_app_process_resident_memory_bytes":
                    gauges["resident_memory_bytes"] = value
                elif sample_name == "mock_app_db_pool_rejections_total":
                    gauges["db_pool_rejections_total"] = value

        for route, total in request_counts.items():
            errors = request_errors[route]
            avg_latency_ms = 0.0
            if duration_count[route]:
                avg_latency_ms = round((duration_sum[route] / duration_count[route]) * 1000, 2)

            route_totals[route] = {
                "total_requests": total,
                "error_requests": errors,
                "error_rate": round((errors / total) * 100, 2) if total else 0.0,
                "avg_latency_ms": avg_latency_ms,
                "status_codes": dict(sorted(request_statuses[route].items())),
            }

        top_routes = sorted(
            route_totals.items(),
            key=lambda item: item[1]["total_requests"],
            reverse=True,
        )

        exceptions = [
            {"exception_type": exception_type, "count": count}
            for exception_type, count in sorted(exception_totals.items(), key=lambda item: item[1], reverse=True)
        ]

        return {
            "service": settings.service_name,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "active_faults": manager.active_faults(),
            "fault_states": fault_states,
            "gauges": {
                "active_requests": int(gauges["active_requests"]),
                "resident_memory_bytes": int(gauges["resident_memory_bytes"]),
                "db_pool_rejections_total": int(gauges["db_pool_rejections_total"]),
            },
            "totals": {
                "requests": round(sum(request_counts.values())),
                "errors": round(sum(request_errors.values())),
                "exceptions": round(sum(exception_totals.values())),
            },
            "routes": [
                {
                    "route": route,
                    "total_requests": int(summary["total_requests"]),
                    "error_requests": int(summary["error_requests"]),
                    "error_rate": summary["error_rate"],
                    "avg_latency_ms": summary["avg_latency_ms"],
                    "status_codes": summary["status_codes"],
                }
                for route, summary in top_routes
            ],
            "exceptions": [
                {"exception_type": item["exception_type"], "count": int(item["count"])}
                for item in exceptions
            ],
        }

    @application.get("/dashboard")
    async def dashboard() -> HTMLResponse:
        return HTMLResponse(
            """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mock SRE Lab Dashboard</title>
  <style>
    :root {
      --bg: #f3efe6;
      --card: rgba(255, 251, 245, 0.9);
      --ink: #1c1a17;
      --muted: #6a6258;
      --accent: #0e7c66;
      --danger: #b23a48;
      --warn: #b06c00;
      --border: rgba(28, 26, 23, 0.12);
      --shadow: 0 18px 40px rgba(68, 51, 31, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(14, 124, 102, 0.16), transparent 28%),
        radial-gradient(circle at top right, rgba(176, 108, 0, 0.12), transparent 22%),
        linear-gradient(180deg, #f7f3eb 0%, var(--bg) 100%);
      min-height: 100vh;
    }
    .shell {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: end;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: clamp(2rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .subtle {
      color: var(--muted);
      max-width: 640px;
      margin-top: 10px;
      font-size: 0.98rem;
    }
    .stamp {
      padding: 12px 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--card);
      box-shadow: var(--shadow);
      min-width: 220px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }
    .card {
      grid-column: span 12;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--card);
      box-shadow: var(--shadow);
      padding: 18px;
      overflow: hidden;
    }
    .card h2 {
      margin: 0 0 12px;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      padding: 16px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.65);
      border: 1px solid rgba(28, 26, 23, 0.08);
    }
    .metric .label {
      display: block;
      color: var(--muted);
      font-size: 0.82rem;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .metric .value {
      font-size: clamp(1.5rem, 4vw, 2.5rem);
      font-weight: 700;
      letter-spacing: -0.04em;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .chip {
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 0.92rem;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.8);
    }
    .chip.active { color: white; background: var(--danger); border-color: transparent; }
    .chip.ok { color: white; background: var(--accent); border-color: transparent; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }
    th, td {
      padding: 10px 8px;
      border-bottom: 1px solid rgba(28, 26, 23, 0.08);
      text-align: left;
      vertical-align: top;
    }
    th {
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 0.78rem;
    }
    .status-strip {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .mini {
      display: inline-block;
      padding: 3px 8px;
      margin: 0 6px 6px 0;
      border-radius: 999px;
      background: rgba(14, 124, 102, 0.1);
      color: var(--accent);
      font-size: 0.85rem;
    }
    .danger { color: var(--danger); }
    .warn { color: var(--warn); }
    .muted { color: var(--muted); }
    .span-8 { grid-column: span 8; }
    .span-4 { grid-column: span 4; }
    @media (max-width: 900px) {
      .hero { flex-direction: column; align-items: start; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .span-8, .span-4 { grid-column: span 12; }
    }
    @media (max-width: 640px) {
      .metrics { grid-template-columns: 1fr; }
      .shell { padding-inline: 14px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <h1>Mock SRE Lab</h1>
        <p class="subtle">Live view of the app's Prometheus metrics. This page refreshes every 3 seconds and is designed for quick local inspection before you pivot into Prometheus, Grafana, Loki, or Tempo.</p>
      </div>
      <div class="stamp">
        <div class="muted">Last updated</div>
        <div id="generatedAt">Waiting for data...</div>
      </div>
    </section>

    <section class="card">
      <h2>Overview</h2>
      <div class="metrics">
        <div class="metric"><span class="label">Total Requests</span><span class="value" id="totalRequests">0</span></div>
        <div class="metric"><span class="label">Error Responses</span><span class="value" id="totalErrors">0</span></div>
        <div class="metric"><span class="label">Exceptions</span><span class="value" id="totalExceptions">0</span></div>
        <div class="metric"><span class="label">Resident Memory</span><span class="value" id="residentMemory">0 MB</span></div>
      </div>
      <div class="status-strip" style="margin-top: 14px;">
        <div class="chip ok" id="activeRequestsChip">0 active requests</div>
        <div class="chip" id="dbPoolChip">0 db pool rejections</div>
      </div>
    </section>

    <section class="grid" style="margin-top: 16px;">
      <article class="card span-8">
        <h2>Route Activity</h2>
        <table>
          <thead>
            <tr>
              <th>Route</th>
              <th>Requests</th>
              <th>Errors</th>
              <th>Error Rate</th>
              <th>Avg Latency</th>
              <th>Status Mix</th>
            </tr>
          </thead>
          <tbody id="routesTable"></tbody>
        </table>
      </article>

      <article class="card span-4">
        <h2>Faults</h2>
        <div class="chips" id="faultsList"></div>
        <h2 style="margin-top: 18px;">Exceptions</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody id="exceptionsTable"></tbody>
        </table>
      </article>
    </section>
  </main>

  <script>
    const formatInteger = (value) => new Intl.NumberFormat().format(value);
    const formatMegabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

    function renderStatusCodes(statusCodes) {
      const entries = Object.entries(statusCodes || {});
      if (!entries.length) return '<span class="muted">no data</span>';
      return entries.map(([code, count]) => `<span class="mini">${code}: ${formatInteger(count)}</span>`).join('');
    }

    function renderRoutes(routes) {
      if (!routes.length) {
        return '<tr><td colspan="6" class="muted">No requests observed yet.</td></tr>';
      }

      return routes.map((route) => `
        <tr>
          <td><strong>${route.route}</strong></td>
          <td>${formatInteger(route.total_requests)}</td>
          <td class="${route.error_requests ? 'danger' : ''}">${formatInteger(route.error_requests)}</td>
          <td class="${route.error_rate >= 10 ? 'danger' : route.error_rate > 0 ? 'warn' : ''}">${route.error_rate.toFixed(2)}%</td>
          <td>${route.avg_latency_ms.toFixed(2)} ms</td>
          <td>${renderStatusCodes(route.status_codes)}</td>
        </tr>
      `).join('');
    }

    function renderFaults(faultStates, activeFaults) {
      const entries = Object.entries(faultStates || {});
      if (!entries.length) {
        return '<span class="chip">No fault metrics yet</span>';
      }

      return entries.map(([fault, active]) => {
        const isActive = activeFaults.includes(fault) || active;
        return `<span class="chip ${isActive ? 'active' : ''}">${fault}${isActive ? ' active' : ' idle'}</span>`;
      }).join('');
    }

    function renderExceptions(exceptions) {
      if (!exceptions.length) {
        return '<tr><td colspan="2" class="muted">No exceptions recorded.</td></tr>';
      }

      return exceptions.map((item) => `
        <tr>
          <td>${item.exception_type}</td>
          <td>${formatInteger(item.count)}</td>
        </tr>
      `).join('');
    }

    async function refresh() {
      const response = await fetch('/api/v1/dashboard/summary', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`dashboard request failed with status ${response.status}`);
      }

      const summary = await response.json();
      document.getElementById('generatedAt').textContent = `${summary.generated_at} | ${summary.service}`;
      document.getElementById('totalRequests').textContent = formatInteger(summary.totals.requests);
      document.getElementById('totalErrors').textContent = formatInteger(summary.totals.errors);
      document.getElementById('totalExceptions').textContent = formatInteger(summary.totals.exceptions);
      document.getElementById('residentMemory').textContent = formatMegabytes(summary.gauges.resident_memory_bytes);
      document.getElementById('activeRequestsChip').textContent = `${formatInteger(summary.gauges.active_requests)} active requests`;
      document.getElementById('dbPoolChip').textContent = `${formatInteger(summary.gauges.db_pool_rejections_total)} db pool rejections`;
      document.getElementById('routesTable').innerHTML = renderRoutes(summary.routes);
      document.getElementById('faultsList').innerHTML = renderFaults(summary.fault_states, summary.active_faults);
      document.getElementById('exceptionsTable').innerHTML = renderExceptions(summary.exceptions);
    }

    async function loop() {
      try {
        await refresh();
      } catch (error) {
        document.getElementById('generatedAt').textContent = `Dashboard error: ${error.message}`;
      } finally {
        window.setTimeout(loop, 3000);
      }
    }

    loop();
  </script>
</body>
</html>
            """
        )

    @application.get("/api/v1/catalog/{sku}")
    async def catalog(sku: str) -> dict[str, Any]:
        manager.maybe_raise_error_burst("/api/v1/catalog/{sku}")
        db_state = await manager.simulate_db_query("catalog_lookup")
        cache_hit = hash(sku) % 5 != 0
        price = round(9.99 + (abs(hash(sku)) % 1500) / 100, 2)
        inventory = abs(hash(f"inv:{sku}")) % 25
        return {
            "sku": sku,
            "cache_hit": cache_hit,
            "price": price,
            "inventory": inventory,
            "db_wait_seconds": db_state["wait_seconds"],
            "active_faults": manager.active_faults(),
        }

    @application.post("/api/v1/checkout")
    async def checkout(payload: dict[str, Any]) -> dict[str, Any]:
        manager.maybe_raise_error_burst("/api/v1/checkout")
        order_id = payload.get("order_id") or f"order-{uuid.uuid4().hex[:8]}"
        amount = float(payload.get("amount", 42.0))

        await manager.simulate_db_query("checkout_prepare")

        with tracer.start_as_current_span("checkout.validate"):
            if amount <= 0:
                raise HTTPException(status_code=400, detail="amount must be greater than zero")
            await asyncio.sleep(random.uniform(0.02, 0.06))

        try:
            payment = await manager.simulate_payment_gateway(amount=amount, order_id=order_id)
        except TimeoutError as exc:
            sentry_sdk.capture_exception(exc)
            EXCEPTIONS_TOTAL.labels(scenario="payment_timeout", exception_type=type(exc).__name__).inc()
            logger.error(
                "checkout_payment_failed",
                extra={"event": "checkout_payment_failed", "order_id": order_id, "amount": amount},
            )
            raise HTTPException(status_code=504, detail="payment provider timeout") from exc

        await manager.simulate_db_query("checkout_commit")

        return {
            "order_id": order_id,
            "status": "confirmed",
            "amount": amount,
            "payment": payment,
            "active_faults": manager.active_faults(),
        }

    @application.get("/api/v1/reports/slow")
    async def reports_slow() -> dict[str, Any]:
        manager.maybe_raise_error_burst("/api/v1/reports/slow")
        with tracer.start_as_current_span("reports.aggregate"):
            total = 0
            for number in range(45_000):
                total += (number * number) % 97
            if manager.is_active("db_pool_exhaustion"):
                await asyncio.sleep(0.8)
            else:
                await asyncio.sleep(0.15)
        return {
            "report": "slow-operations",
            "checksum": total,
            "active_faults": manager.active_faults(),
        }

    @application.post("/internal/faults/{scenario}")
    async def set_fault(scenario: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        enabled = payload.get("enabled", True)
        source = str(payload.get("source", "manual"))
        duration = payload.get("duration_seconds")
        try:
            if enabled:
                return await manager.activate(scenario, duration_seconds=duration, source=source)
            return await manager.deactivate(scenario, source=source)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario}") from exc

    return application


app = create_app()
