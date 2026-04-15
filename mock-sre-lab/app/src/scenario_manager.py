from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import psutil
from fastapi import HTTPException
from opentelemetry import trace

from .metrics import (
    DB_POOL_REJECTIONS_TOTAL,
    DB_POOL_WAIT_SECONDS,
    EXCEPTIONS_TOTAL,
    FAULT_ACTIVE,
    PROCESS_RESIDENT_MEMORY_BYTES,
)


tracer = trace.get_tracer("mock-sre-app.scenarios")


@dataclass
class ScenarioActivation:
    name: str
    source: str
    expires_at: float | None


class ScenarioManager:
    def __init__(self, scenario_file: str, logger: logging.Logger, db_pool_size: int) -> None:
        payload = json.loads(Path(scenario_file).read_text())
        self.definitions: dict[str, dict[str, Any]] = payload["scenarios"]
        self.schedules: dict[str, dict[str, Any]] = payload.get("schedules", {})
        self.logger = logger
        self._lock = asyncio.Lock()
        self._active: dict[str, ScenarioActivation] = {}
        self._memory_chunks: list[bytearray] = []
        self._db_pool = asyncio.Semaphore(db_pool_size)
        self._process = psutil.Process()

    async def activate(self, name: str, duration_seconds: int | None, source: str) -> dict[str, Any]:
        if name not in self.definitions:
            raise KeyError(name)

        config = self.definitions[name]
        duration = duration_seconds or int(config.get("default_duration_seconds", 120))
        expires_at = time.monotonic() + duration if duration > 0 else None

        async with self._lock:
            self._active[name] = ScenarioActivation(name=name, source=source, expires_at=expires_at)
            self._sync_fault_metrics()

        self.logger.warning(
            "fault_activated",
            extra={
                "event": "fault_activated",
                "fault_name": name,
                "duration_seconds": duration,
                "source": source,
            },
        )
        return self.snapshot()

    async def deactivate(self, name: str, source: str) -> dict[str, Any]:
        async with self._lock:
            self._active.pop(name, None)
            self._sync_fault_metrics()

        self.logger.warning(
            "fault_deactivated",
            extra={"event": "fault_deactivated", "fault_name": name, "source": source},
        )
        return self.snapshot()

    def is_active(self, name: str) -> bool:
        self._prune_expired()
        return name in self._active

    def active_faults(self) -> list[str]:
        self._prune_expired()
        return sorted(self._active.keys())

    def active_faults_csv(self) -> str:
        faults = self.active_faults()
        return ",".join(faults) if faults else "none"

    def scenario_config(self, name: str) -> dict[str, Any]:
        return self.definitions[name]

    def snapshot(self) -> dict[str, Any]:
        self._prune_expired()
        return {
            "active_faults": self.active_faults(),
            "defined_faults": sorted(self.definitions.keys()),
        }

    def schedule(self, name: str) -> dict[str, Any]:
        return self.schedules[name]

    async def periodic_housekeeping(self) -> None:
        while True:
            self._prune_expired()
            if self.is_active("memory_leak"):
                leak_chunk_kb = int(self.definitions["memory_leak"].get("leak_chunk_kb", 512))
                self._memory_chunks.append(bytearray(leak_chunk_kb * 1024))
            PROCESS_RESIDENT_MEMORY_BYTES.set(self._process.memory_info().rss)
            await asyncio.sleep(2)

    async def simulate_db_query(self, operation: str) -> dict[str, Any]:
        cfg = self.definitions.get("db_pool_exhaustion", {})
        acquire_timeout = 0.5
        extra_sleep = 0.0
        error_rate = 0.0

        if self.is_active("db_pool_exhaustion"):
            acquire_timeout = float(cfg.get("acquire_timeout_seconds", 0.08))
            extra_sleep = random.uniform(
                float(cfg.get("slowdown_seconds_min", 0.2)),
                float(cfg.get("slowdown_seconds_max", 0.8)),
            )
            error_rate = float(cfg.get("error_rate", 0.25))

        start = time.perf_counter()
        try:
            await asyncio.wait_for(self._db_pool.acquire(), timeout=acquire_timeout)
        except TimeoutError as exc:
            DB_POOL_REJECTIONS_TOTAL.inc()
            EXCEPTIONS_TOTAL.labels(
                scenario="db_pool_exhaustion" if self.is_active("db_pool_exhaustion") else "none",
                exception_type=type(exc).__name__,
            ).inc()
            raise HTTPException(status_code=503, detail="database pool exhausted") from exc

        wait_seconds = time.perf_counter() - start
        DB_POOL_WAIT_SECONDS.observe(wait_seconds)

        try:
            with tracer.start_as_current_span("db.query") as span:
                span.set_attribute("db.operation", operation)
                span.set_attribute("db.pool_wait_seconds", wait_seconds)
                await asyncio.sleep(random.uniform(0.02, 0.08) + extra_sleep)
                if error_rate and random.random() < error_rate:
                    raise HTTPException(status_code=503, detail="database pressure caused partial failure")
                return {"wait_seconds": round(wait_seconds, 4)}
        finally:
            self._db_pool.release()

    async def simulate_payment_gateway(self, amount: float, order_id: str) -> dict[str, Any]:
        cfg = self.definitions.get("payment_timeout", {})
        retry_attempts = int(cfg.get("retry_attempts", 3))

        for attempt in range(1, retry_attempts + 1):
            with tracer.start_as_current_span("payment.gateway") as span:
                span.set_attribute("payment.order_id", order_id)
                span.set_attribute("payment.amount", amount)
                span.set_attribute("payment.attempt", attempt)
                try:
                    if self.is_active("payment_timeout") and random.random() < float(cfg.get("error_rate", 0.8)):
                        await asyncio.sleep(float(cfg.get("timeout_seconds", 1.2)))
                        raise TimeoutError("simulated payment gateway timeout")
                    await asyncio.sleep(random.uniform(0.05, 0.15))
                    return {
                        "authorization_id": f"auth-{random.randint(10000, 99999)}",
                        "provider": "mockpay",
                        "attempt": attempt,
                    }
                except TimeoutError:
                    self.logger.warning(
                        "payment_timeout",
                        extra={
                            "event": "payment_timeout",
                            "attempt": attempt,
                            "order_id": order_id,
                            "amount": amount,
                        },
                    )
                    if attempt == retry_attempts:
                        raise
        raise TimeoutError("payment gateway failed after retries")

    def maybe_raise_error_burst(self, route: str) -> None:
        if not self.is_active("error_burst"):
            return

        error_rate = float(self.definitions["error_burst"].get("error_rate", 0.55))
        if random.random() >= error_rate:
            return

        with tracer.start_as_current_span("fault.error_burst") as span:
            span.set_attribute("route", route)
            raise RuntimeError(f"simulated error burst on {route}")

    def _prune_expired(self) -> None:
        now = time.monotonic()
        expired = [name for name, activation in self._active.items() if activation.expires_at and activation.expires_at <= now]
        for name in expired:
            self._active.pop(name, None)
        self._sync_fault_metrics()

    def _sync_fault_metrics(self) -> None:
        for scenario_name in self.definitions:
            FAULT_ACTIVE.labels(scenario=scenario_name).set(1 if scenario_name in self._active else 0)

