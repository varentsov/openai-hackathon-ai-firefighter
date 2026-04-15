from __future__ import annotations

import json
import logging
import sys
import time
from contextvars import ContextVar
from typing import Any

from opentelemetry import trace


request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
route_var: ContextVar[str] = ContextVar("route", default="-")
scenario_var: ContextVar[str] = ContextVar("scenario", default="none")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        span_context = trace.get_current_span().get_span_context()
        trace_id = format(span_context.trace_id, "032x") if span_context.trace_id else "-"
        span_id = format(span_context.span_id, "016x") if span_context.span_id else "-"

        payload: dict[str, Any] = {
          "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
          "level": record.levelname,
          "logger": record.name,
          "message": record.getMessage(),
          "request_id": request_id_var.get(),
          "trace_id": trace_id,
          "span_id": span_id,
          "route": route_var.get(),
          "scenario": scenario_var.get(),
        }

        for key, value in record.__dict__.items():
            if key.startswith("_") or key in {
                "args",
                "asctime",
                "created",
                "exc_info",
                "exc_text",
                "filename",
                "funcName",
                "levelname",
                "levelno",
                "lineno",
                "module",
                "msecs",
                "message",
                "msg",
                "name",
                "pathname",
                "process",
                "processName",
                "relativeCreated",
                "stack_info",
                "thread",
                "threadName",
            }:
                continue
            payload[key] = value

        if record.exc_info:
            exc_type = record.exc_info[0].__name__ if record.exc_info[0] else "Exception"
            exc_message = str(record.exc_info[1]) if record.exc_info[1] else ""
            payload["exception_type"] = exc_type
            payload["exception_message"] = exc_message

        return json.dumps(payload, default=str)


def configure_logging(level: str) -> logging.Logger:
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
    logging.getLogger("uvicorn.access").handlers.clear()
    logging.getLogger("uvicorn.error").handlers.clear()
    return logging.getLogger("mock_sre_app")

