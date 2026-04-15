import { REQUIRED_OBSERVATIONS } from "../contracts/observability.js";
import { InMemoryLangfuseAdapter } from "../adapters/langfuseAdapter.js";
import { MockDataAdapter } from "../adapters/mockDataAdapter.js";
import type {
  AnalyzeResponse,
  DeploymentAnnotation,
  ExecuteResponse,
  GitHistoryEntry,
  LogEvent,
  MetricSnapshot,
  RankedAction,
  RollbackPlan,
  RunTraceEvent,
} from "@openai-hackathon/demo-contracts";

export interface AgentOrchestratorOptions {
  dataAdapter: MockDataAdapter;
  langfuseAdapter: InMemoryLangfuseAdapter;
}

export class AgentOrchestrator {
  private readonly dataAdapter: MockDataAdapter;
  private readonly langfuseAdapter: InMemoryLangfuseAdapter;
  private activeTraceId?: string;

  constructor(options: AgentOrchestratorOptions) {
    this.dataAdapter = options.dataAdapter;
    this.langfuseAdapter = options.langfuseAdapter;
  }

  analyzeIncident(): AnalyzeResponse {
    const incident = this.dataAdapter.getIncident();
    const scenario = this.dataAdapter.getScenario();
    const traceId = this.langfuseAdapter.startTrace({
      incidentId: incident.id,
      service: incident.service,
      symptom: incident.symptom,
      coreJourney: scenario.criticalityConfig.coreJourney,
      degradableDependency: scenario.expectedAnalysis.pressurePoint,
      scenario: "faulty_commit_regression",
      bestFirstAction: scenario.expectedAnalysis.bestFirstAction,
      recovered: false,
    });
    const beforeMetrics = this.dataAdapter.getMetricSnapshot("before");
    const beforeLogs = this.dataAdapter.getLogs("before");
    const annotation = this.dataAdapter.getDeploymentAnnotation();
    const commits = this.dataAdapter.getRecentCommits();
    const suspectCommit = this.rankSuspectCommits(commits, annotation)[0];
    const rankedActions = this.rankActions(beforeMetrics, beforeLogs, suspectCommit);
    const rollbackPlan = this.buildRollbackPlan(suspectCommit);
    const why = this.buildWhy(beforeMetrics, beforeLogs, annotation, suspectCommit);

    this.activeTraceId = traceId;

    this.langfuseAdapter.recordStep(
      traceId,
      "receive_incident",
      `${incident.id} ${incident.service}/${incident.symptom}`,
      `Severity ${incident.severity} incident accepted for investigation`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "query_metrics_before",
      "Load checkout and recommendations metrics for the pre-mitigation stage",
      `Checkout p95 ${beforeMetrics.checkoutP95Ms}ms, recommendations p95 ${beforeMetrics.recommendationsP95Ms}ms`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "query_logs_before",
      "Load recent checkout logs for the pre-mitigation stage",
      `${beforeLogs.length} correlated log lines show synchronous recommendation failures`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "fetch_deployment_annotation",
      "Look up recent deploy evidence in the last 30 minutes",
      `Deployment ${annotation.id} references commit ${annotation.commitSha}`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "inspect_git_history",
      "Inspect recent git history touching checkout and recommendations",
      `${commits.length} commits considered for the regression window`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "rank_suspect_commits",
      "Correlate deploy annotation with suspect scores",
      `Top suspect ${suspectCommit.sha} with rollback target ${suspectCommit.rollbackTarget}`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "rank_actions",
      "Prioritize graceful degradation, rollback guidance, and worker scaling",
      `${rankedActions[0].id} ranked first with score ${rankedActions[0].priorityScore}`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "simulate_rollback",
      `Dry-run rollback for ${suspectCommit.sha}`,
      `Rollback would land on ${rollbackPlan.targetSha} with confidence ${rollbackPlan.confidence}`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "recommend_primary_action",
      "Pick the safest business-preserving next step",
      `${rankedActions[0].title} recommended before rollback or scaling`,
    );

    return {
      severity: incident.severity,
      why,
      pressurePoint: scenario.expectedAnalysis.pressurePoint,
      bestFirstAction: rankedActions[0],
      nextActions: rankedActions.slice(1),
      metrics: {
        before: beforeMetrics,
      },
      logs: beforeLogs,
      commits,
      suspectCommit,
      rollbackPlan,
      annotation,
      traceId,
    };
  }

  executeDisableRecommendations(): ExecuteResponse {
    const traceId = this.activeTraceId ?? this.analyzeIncident().traceId;

    if (!traceId) {
      throw new Error("Trace ID was not created for the incident run");
    }

    const execution = this.dataAdapter.disableRecommendations();
    const afterMetrics = this.dataAdapter.getMetricSnapshot("after");
    const afterLogs = this.dataAdapter.getLogs("after");
    const recovered =
      afterMetrics.checkoutP95Ms <= 1000 && afterMetrics.checkoutErrorRate <= 0.02;
    const summary = recovered
      ? "Core path stabilized. Recommendations remain degraded, but checkout latency returned to the healthy range."
      : "Recommendations were disabled, but checkout is still unhealthy and needs the next recommendation.";

    this.langfuseAdapter.recordStep(
      traceId,
      "execute_primary_action",
      "Execute disable_recommendations in the mock control plane",
      execution.changed ? "Recommendations disabled successfully" : "Recommendations were already disabled",
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "query_metrics_after",
      "Re-check the same health signals after mitigation",
      `Checkout p95 ${afterMetrics.checkoutP95Ms}ms, error rate ${afterMetrics.checkoutErrorRate}`,
    );
    this.langfuseAdapter.recordStep(
      traceId,
      "final_summary",
      "Summarize incident outcome for the operator",
      summary,
    );
    this.langfuseAdapter.finishTrace(traceId, summary);

    return {
      action: execution.action,
      result: execution.changed ? "executed" : "noop",
      metrics: {
        after: afterMetrics,
      },
      logs: afterLogs,
      recovered,
      summary,
      traceId,
    };
  }

  getTraceEvents(traceId?: string): RunTraceEvent[] {
    return this.langfuseAdapter.listEvents(traceId);
  }

  getRequiredObservations(): readonly string[] {
    return REQUIRED_OBSERVATIONS;
  }

  private rankSuspectCommits(
    commits: GitHistoryEntry[],
    annotation: DeploymentAnnotation,
  ): GitHistoryEntry[] {
    return structuredClone(commits).sort((left, right) => {
      const leftScore = left.suspectScore + Number(left.sha === annotation.commitSha) * 0.08;
      const rightScore =
        right.suspectScore + Number(right.sha === annotation.commitSha) * 0.08;

      return rightScore - leftScore;
    });
  }

  private rankActions(
    metrics: MetricSnapshot,
    logs: LogEvent[],
    suspectCommit: GitHistoryEntry,
  ): RankedAction[] {
    const logPressure = logs.filter((log) => log.level !== "info").length;
    const scalingScore = metrics.workerSaturation >= 0.8 ? 58 : 42;

    const actions: RankedAction[] = [
      {
        id: "disable_recommendations",
        title: "Disable recommendations",
        reason:
          "Recommendations are optional for checkout and are directly implicated by metrics, logs, and the recent deploy.",
        expectedTradeoff:
          "Personalization quality drops, but the checkout conversion path is protected immediately.",
        priorityScore: 96,
        reversible: true,
        executable: true,
        approved: false,
        executed: !this.dataAdapter.isRecommendationsEnabled(),
      },
      {
        id: "rollback_canary",
        title: "Rollback canary",
        reason: `Recent commit ${suspectCommit.sha} aligns with the deployment window and should remain the next recommendation if latency persists.`,
        expectedTradeoff:
          "This preserves features better than blanket degradation, but it is a slower operator action than flipping one lever.",
        priorityScore: 81 + logPressure,
        reversible: true,
        executable: false,
        approved: false,
        executed: false,
      },
      {
        id: "scale_workers",
        title: "Scale workers",
        reason:
          "Worker saturation is elevated, but it looks secondary to the synchronous recommendations regression.",
        expectedTradeoff:
          "Scaling may reduce queueing pressure but does not remove the bad dependency path from checkout.",
        priorityScore: scalingScore,
        reversible: true,
        executable: false,
        approved: false,
        executed: false,
      },
    ];

    return actions.sort((left, right) => right.priorityScore - left.priorityScore);
  }

  private buildRollbackPlan(suspectCommit: GitHistoryEntry): RollbackPlan {
    return {
      targetSha: suspectCommit.rollbackTarget,
      mode: "dry_run",
      expectedOutcome:
        "Restores the last pre-regression checkout path while leaving the current payment handling intact.",
      confidence: 0.86,
    };
  }

  private buildWhy(
    metrics: MetricSnapshot,
    logs: LogEvent[],
    annotation: DeploymentAnnotation,
    suspectCommit: GitHistoryEntry,
  ): string {
    const latestLog = logs[0];

    return `Checkout p95 is ${metrics.checkoutP95Ms}ms while recommendations p95 is ${metrics.recommendationsP95Ms}ms. The latest deployment annotation points to ${annotation.commitSha}, and logs such as "${latestLog.message}" reinforce that commit ${suspectCommit.sha} pushed synchronous recommendations pressure into the checkout path.`;
  }
}
