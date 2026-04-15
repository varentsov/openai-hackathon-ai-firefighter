from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

import httpx


LOADGEN_ENABLED = os.getenv("LOADGEN_ENABLED", "true").lower() in {"1", "true", "yes", "on"}
LOADGEN_RPS = float(os.getenv("LOADGEN_RPS", "2.5"))
BASE_URL = os.getenv("LOADGEN_BASE_URL", "http://app:8080")
SCENARIO_FILE = os.getenv("SCENARIO_FILE", "/app/scenarios/scenarios.json")
FAULT_SCHEDULE = os.getenv("FAULT_SCHEDULE", "default")


def log(message: str, **fields: object) -> None:
    payload = {"timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "message": message, **fields}
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


class LoadGenerator:
    def __init__(self) -> None:
        self.config = json.loads(Path(SCENARIO_FILE).read_text())
        self.schedule = self.config["schedules"][FAULT_SCHEDULE]
        self.cycle_seconds = int(self.schedule["cycle_seconds"])
        self.events = self.schedule["events"]
        self.triggered: dict[tuple[int, str], bool] = {}
        self.started_at = time.monotonic()
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0))

    async def run(self) -> None:
        await asyncio.gather(self._traffic_loop(), self._schedule_loop())

    async def _traffic_loop(self) -> None:
        if not LOADGEN_ENABLED:
            log("loadgen_disabled")
            while True:
                await asyncio.sleep(60)

        interval = 1.0 / max(LOADGEN_RPS, 0.1)
        while True:
            await self._fire_once()
            await asyncio.sleep(interval)

    async def _schedule_loop(self) -> None:
        while True:
            elapsed = time.monotonic() - self.started_at
            cycle = int(elapsed // self.cycle_seconds)
            offset = int(elapsed % self.cycle_seconds)

            for index, event in enumerate(self.events):
                event_key = (cycle, f"{index}:{event['name']}")
                if offset < int(event["offset_seconds"]) or event_key in self.triggered:
                    continue
                self.triggered[event_key] = True
                await self._activate_fault(event)

            await asyncio.sleep(1)

    async def _activate_fault(self, event: dict[str, object]) -> None:
        scenario = str(event["name"])
        payload = {
            "enabled": True,
            "duration_seconds": int(event["duration_seconds"]),
            "source": "schedule",
        }
        try:
            response = await self.client.post(f"{BASE_URL}/internal/faults/{scenario}", json=payload)
            log("fault_scheduled", scenario=scenario, status_code=response.status_code)
        except Exception as exc:  # noqa: BLE001
            log("fault_schedule_failed", scenario=scenario, error=str(exc))

    async def _fire_once(self) -> None:
        choice = random.choices(
            population=["catalog", "catalog", "catalog", "checkout", "checkout", "reports"],
            weights=[4, 4, 4, 2, 2, 1],
            k=1,
        )[0]
        try:
            if choice == "catalog":
                sku = f"sku-{random.randint(100, 999)}"
                response = await self.client.get(f"{BASE_URL}/api/v1/catalog/{sku}")
            elif choice == "checkout":
                response = await self.client.post(
                    f"{BASE_URL}/api/v1/checkout",
                    json={
                        "order_id": f"ord-{random.randint(1000, 9999)}",
                        "amount": round(random.uniform(15, 250), 2),
                    },
                )
            else:
                response = await self.client.get(f"{BASE_URL}/api/v1/reports/slow")

            log("request_sent", endpoint=choice, status_code=response.status_code)
        except Exception as exc:  # noqa: BLE001
            log("request_failed", endpoint=choice, error=str(exc))


async def main() -> None:
    loadgen = LoadGenerator()
    await loadgen.run()


if __name__ == "__main__":
    asyncio.run(main())
