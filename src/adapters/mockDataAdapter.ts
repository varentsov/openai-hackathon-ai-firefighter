import type {
  DemoStateResponse,
  DeploymentAnnotation,
  ExecuteResponse,
  GitHistoryEntry,
  Incident,
  IncidentRollbackScenario,
  LogEvent,
  MetricSnapshot,
} from "@openai-hackathon/demo-contracts";
import { getIncidentRollbackScenario } from "../data/incidentRollbackScenario.js";

export interface DisableRecommendationsResult {
  changed: boolean;
  action: ExecuteResponse["action"];
}

export class MockDataAdapter {
  private readonly baseScenario: IncidentRollbackScenario;
  private recommendationsEnabled = true;

  constructor(scenario: IncidentRollbackScenario = getIncidentRollbackScenario()) {
    this.baseScenario = structuredClone(scenario);
  }

  getIncident(): Incident {
    const incident = structuredClone(this.baseScenario.incident);

    if (!this.recommendationsEnabled) {
      incident.status = "mitigated";
    }

    return incident;
  }

  getMetricSnapshot(stage: "before" | "after"): MetricSnapshot {
    return structuredClone(this.baseScenario.metrics[stage]);
  }

  getCurrentMetricSnapshot(): MetricSnapshot {
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

  disableRecommendations(): DisableRecommendationsResult {
    if (!this.recommendationsEnabled) {
      return {
        changed: false,
        action: "disable_recommendations",
      };
    }

    this.recommendationsEnabled = false;

    return {
      changed: true,
      action: "disable_recommendations",
    };
  }

  getDemoState(): DemoStateResponse {
    const scenario = this.getScenario();

    return {
      incident: this.getIncident(),
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
      architectureReferences: [
        "design-draft.md",
        "mock-sre-lab/PLAN.md",
        "docs/langfuse-observability-contract.md",
      ],
    };
  }
}
