import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { FaultScenario, MetricSnapshot } from "@openai-hackathon/demo-contracts";

const mockSreLabRoot = resolve(fileURLToPath(new URL("../../mock-sre-lab", import.meta.url)));
const defaultScenarioFile = resolve(mockSreLabRoot, "scenarios/scenarios.json");
const liveFaults = [
  "payment_timeout",
  "db_pool_exhaustion",
  "error_burst",
  "memory_leak",
] as const satisfies readonly FaultScenario[];

type QueryVectorResult = {
  metric: Record<string, string>;
  value: [number | string, string];
};

interface PrometheusQueryResponse {
  status: "success" | "error";
  data?: {
    resultType: string;
    result: QueryVectorResult[];
  };
}

interface HealthzResponse {
  active_faults?: string[];
}

export interface MockSreLabLiveState {
  activeFaults: FaultScenario[];
  metrics: MetricSnapshot;
}

function isFaultScenario(value: string): value is FaultScenario {
  return (liveFaults as readonly string[]).includes(value);
}

export class MockSreLabClient {
  private readonly appBaseUrl: string;
  private readonly prometheusBaseUrl: string;
  private readonly scenarioFilePath: string;
  private cachedState?: MockSreLabLiveState;
  private cachedAt = 0;

  constructor(options?: {
    appBaseUrl?: string;
    prometheusBaseUrl?: string;
    scenarioFilePath?: string;
  }) {
    this.appBaseUrl = (options?.appBaseUrl ?? process.env.MOCK_SRE_LAB_APP_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
    this.prometheusBaseUrl = (
      options?.prometheusBaseUrl ??
      process.env.MOCK_SRE_LAB_PROMETHEUS_URL ??
      "http://127.0.0.1:9090"
    ).replace(/\/$/, "");
    this.scenarioFilePath = options?.scenarioFilePath ?? process.env.MOCK_SRE_LAB_SCENARIO_FILE ?? defaultScenarioFile;
  }

  getScenarioFilePath(): string {
    return this.scenarioFilePath;
  }

  getDefinedFaults(): FaultScenario[] {
    try {
      const payload = JSON.parse(readFileSync(this.scenarioFilePath, "utf-8")) as {
        scenarios?: Record<string, unknown>;
      };

      return Object.keys(payload.scenarios ?? {}).filter(isFaultScenario);
    } catch {
      return [...liveFaults];
    }
  }

  async getLiveState(forceRefresh = false): Promise<MockSreLabLiveState | undefined> {
    if (!forceRefresh && this.cachedState && Date.now() - this.cachedAt < 2_000) {
      return structuredClone(this.cachedState);
    }

    try {
      const [activeFaults, metrics] = await Promise.all([
        this.fetchActiveFaults(),
        this.fetchMetrics(),
      ]);
      const state = {
        activeFaults,
        metrics,
      } satisfies MockSreLabLiveState;

      this.cachedState = state;
      this.cachedAt = Date.now();
      return structuredClone(state);
    } catch {
      return undefined;
    }
  }

  async deactivateFault(fault: FaultScenario): Promise<boolean> {
    try {
      const response = await fetch(`${this.appBaseUrl}/internal/faults/${fault}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: false,
          source: "ai-firefighter",
        }),
      });

      if (!response.ok) {
        return false;
      }

      this.cachedState = undefined;
      this.cachedAt = 0;
      return true;
    } catch {
      return false;
    }
  }

  private async fetchActiveFaults(): Promise<FaultScenario[]> {
    try {
      const response = await fetch(`${this.appBaseUrl}/healthz`);
      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as HealthzResponse;
      return (payload.active_faults ?? []).filter(isFaultScenario);
    } catch {
      const results = await this.queryVector("mock_app_fault_active == 1");
      return results
        .map((entry) => entry.metric.scenario)
        .filter(isFaultScenario);
    }
  }

  private async fetchMetrics(): Promise<MetricSnapshot> {
    const [
      checkoutP95Ms,
      checkoutErrorRate,
      optionalP95Ms,
      optionalErrorRate,
      requestVolumeRps,
      workerSaturation,
    ] = await Promise.all([
      this.queryScalar(
        'histogram_quantile(0.95, sum(rate(mock_app_request_duration_seconds_bucket{route="/api/v1/checkout"}[5m])) by (le)) * 1000',
      ),
      this.queryScalar(
        'sum(rate(mock_app_requests_total{route="/api/v1/checkout",status_code=~"5.."}[5m])) / clamp_min(sum(rate(mock_app_requests_total{route="/api/v1/checkout"}[5m])), 0.001)',
      ),
      this.queryScalar(
        'histogram_quantile(0.95, sum(rate(mock_app_request_duration_seconds_bucket{route="/api/v1/reports/slow"}[5m])) by (le)) * 1000',
      ),
      this.queryScalar(
        'sum(rate(mock_app_requests_total{route="/api/v1/reports/slow",status_code=~"5.."}[5m])) / clamp_min(sum(rate(mock_app_requests_total{route="/api/v1/reports/slow"}[5m])), 0.001)',
      ),
      this.queryScalar(
        'sum(rate(mock_app_requests_total{route!="/metrics"}[5m]))',
      ),
      this.queryScalar(
        "clamp_max(max(mock_app_active_requests) / 20 + histogram_quantile(0.95, sum(rate(mock_app_db_pool_wait_seconds_bucket[5m])) by (le)), 1)",
      ),
    ]);

    return {
      timestamp: new Date().toISOString(),
      checkoutP95Ms: Math.round(checkoutP95Ms),
      checkoutErrorRate: this.normalizeRatio(checkoutErrorRate),
      recommendationsP95Ms: Math.round(optionalP95Ms),
      recommendationsErrorRate: this.normalizeRatio(optionalErrorRate),
      requestVolumeRps: Number(requestVolumeRps.toFixed(2)),
      workerSaturation: this.normalizeRatio(workerSaturation),
    };
  }

  private normalizeRatio(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  private async queryScalar(query: string): Promise<number> {
    const results = await this.queryVector(query);
    const raw = results[0]?.value[1];
    const parsed = Number(raw);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async queryVector(query: string): Promise<QueryVectorResult[]> {
    const url = new URL("/api/v1/query", this.prometheusBaseUrl);
    url.searchParams.set("query", query);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Prometheus query failed with status ${response.status}`);
    }

    const payload = (await response.json()) as PrometheusQueryResponse;
    if (payload.status !== "success") {
      throw new Error("Prometheus query returned an error payload");
    }

    return payload.data?.result ?? [];
  }
}
