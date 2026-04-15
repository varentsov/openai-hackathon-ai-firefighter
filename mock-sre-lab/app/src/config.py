from __future__ import annotations

import os
from dataclasses import dataclass


def _bool_env(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_port: int = int(os.getenv("APP_PORT", "8080"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    service_name: str = os.getenv("OTEL_SERVICE_NAME", "mock-sre-app")
    otlp_endpoint: str = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://alloy:4317")
    glitchtip_dsn: str = os.getenv("GLITCHTIP_DSN", "")
    scenario_file: str = os.getenv("SCENARIO_FILE", "/app/scenarios/scenarios.json")
    fault_schedule: str = os.getenv("FAULT_SCHEDULE", "default")
    db_pool_size: int = int(os.getenv("DB_POOL_SIZE", "6"))
    metrics_enabled: bool = _bool_env("METRICS_ENABLED", True)


settings = Settings()

