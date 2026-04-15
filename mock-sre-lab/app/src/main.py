from __future__ import annotations

import asyncio
import contextlib
import logging
import random
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode
from prometheus_client import make_asgi_app

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

    application.mount("/metrics", make_asgi_app())

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
