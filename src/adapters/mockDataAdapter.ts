import type {
  DemoStateResponse,
  DeploymentAnnotation,
  ExecuteResponse,
  FaultScenario,
  GitHistoryEntry,
  Incident,
  IncidentRollbackScenario,
  LogEvent,
  MetricSnapshot,
} from "@openai-hackathon/demo-contracts";
import { getIncidentRollbackScenario } from "../data/incidentRollbackScenario.js";
import { MockSreLabClient } from "./mockSreLabClient.js";

export interface DisableRecommendationsResult {
  changed: boolean;
  action: ExecuteResponse["action"];
  targetFault?: FaultScenario;
  usedLiveControl?: boolean;
}

export class MockDataAdapter {
  private readonly baseScenario: IncidentRollbackScenario;
  private readonly mockSreLabClient: MockSreLabClient;
  private recommendationsEnabled = true;

  constructor(
    scenario: IncidentRollbackScenario = getIncidentRollbackScenario(),
    mockSreLabClient = new MockSreLabClient(),
  ) {
    this.baseScenario = structuredClone(scenario);
    this.mockSreLabClient = mockSreLabClient;
  }

  async getIncident(): Promise<Incident> {
    const incident = structuredClone(this.baseScenario.incident);
    const liveState = await this.mockSreLabClient.getLiveState();

    if (!this.recommendationsEnabled) {
      incident.status = "mitigated";
    }

    if (liveState?.activeFaults.length) {
      incident.id = `inc_checkout_${liveState.activeFaults[0]}`;
      incident.startedAt = liveState.metrics.timestamp;
      incident.severity = this.deriveSeverity(liveState.activeFaults);
    }

    return incident;
  }

  async getMetricSnapshot(stage: "before" | "after"): Promise<MetricSnapshot> {
    const liveState = await this.mockSreLabClient.getLiveState(stage === "after");
    if (liveState?.metrics) {
      return structuredClone(liveState.metrics);
    }

    return structuredClone(this.baseScenario.metrics[stage]);
  }

  async getCurrentMetricSnapshot(): Promise<MetricSnapshot> {
    return this.getMetricSnapshot(this.recommendationsEnabled ? "before" : "after");
  }

  getLogs(stage: "before" | "after"): LogEvent[] {
    return structuredClone(this.baseScenario.logs[stage]);
  }

  getCurrentLogs(): LogEvent[] {
    return this.getLogs(this.recommendationsEnabled ? "before" : "after");
  }

  getDeploymentAnnotation(): DeploymentAnnotation {
    return structuredClone(this.baseScenario.annotation);
  }

  getRecentCommits(limit = 10): GitHistoryEntry[] {
    return structuredClone(this.baseScenario.gitHistory.slice(0, limit));
  }

  getScenario(): IncidentRollbackScenario {
    return structuredClone(this.baseScenario);
  }

  isRecommendationsEnabled(): boolean {
    return this.recommendationsEnabled;
  }

  async getActiveFaults(): Promise<FaultScenario[]> {
    return (await this.mockSreLabClient.getLiveState())?.activeFaults ?? [];
  }

  async disableRecommendations(): Promise<DisableRecommendationsResult> {
    if (!this.recommendationsEnabled) {
      return {
        changed: false,
        action: "disable_recommendations",
      };
    }

    this.recommendationsEnabled = false;
    const activeFaults = await this.getActiveFaults();
    const targetFault = activeFaults[0];
    const usedLiveControl = targetFault
      ? await this.mockSreLabClient.deactivateFault(targetFault)
      : false;

    return {
      changed: true,
      action: "disable_recommendations",
      targetFault,
      usedLiveControl,
    };
  }

  async getDemoState(): Promise<DemoStateResponse> {
    const scenario = this.getScenario();
    const liveState = await this.mockSreLabClient.getLiveState();
    const activeFaults = liveState?.activeFaults ?? [];
    const metricsSource = liveState ? "prometheus_mock_sre_lab" : "static_fixture";

    return {
      incident: await this.getIncident(),
      configSummary: {
        coreJourney: scenario.criticalityConfig.coreJourney,
        degradableDependencies: structuredClone(
          scenario.criticalityConfig.degradableDependencies,
        ),
        leverIds: scenario.criticalityConfig.levers.map((lever) => lever.id),
      },
      beforeAvailable: true,
      afterAvailable: true,
      recommendationsEnabled: this.recommendationsEnabled,
      metricsSource,
      activeFaults,
      architectureReferences: [
        "design-draft.md",
        "mock-sre-lab/PLAN.md",
        "mock-sre-lab/SRE_AGENT_INTEGRATION.md",
        "mock-sre-lab/scenarios/scenarios.json",
        "docs/langfuse-observability-contract.md",
      ],
    };
  }

  private deriveSeverity(activeFaults: FaultScenario[]): Incident["severity"] {
    if (activeFaults.includes("payment_timeout") || activeFaults.includes("error_burst")) {
      return "sev2";
    }

    if (activeFaults.includes("db_pool_exhaustion")) {
      return "sev3";
    }

    return "sev4";
  }
}
