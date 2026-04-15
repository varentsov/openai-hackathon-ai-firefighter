from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram


REQUESTS_TOTAL = Counter(
    "mock_app_requests_total",
    "Total HTTP requests handled by the mock app.",
    ["method", "route", "status_code"],
)

REQUEST_DURATION_SECONDS = Histogram(
    "mock_app_request_duration_seconds",
    "HTTP request latency.",
    ["method", "route"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10),
)

FAULT_ACTIVE = Gauge(
    "mock_app_fault_active",
    "Whether a fault scenario is currently active.",
    ["scenario"],
)

EXCEPTIONS_TOTAL = Counter(
    "mock_app_exceptions_total",
    "Total exceptions raised by the mock app.",
    ["scenario", "exception_type"],
)

DB_POOL_WAIT_SECONDS = Histogram(
    "mock_app_db_pool_wait_seconds",
    "Observed DB pool wait time.",
    buckets=(0.001, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
)

DB_POOL_REJECTIONS_TOTAL = Counter(
    "mock_app_db_pool_rejections_total",
    "Total DB pool acquire failures.",
)

PROCESS_RESIDENT_MEMORY_BYTES = Gauge(
    "mock_app_process_resident_memory_bytes",
    "Resident memory for the mock app process.",
)

ACTIVE_REQUESTS = Gauge(
    "mock_app_active_requests",
    "In-flight HTTP requests.",
)

