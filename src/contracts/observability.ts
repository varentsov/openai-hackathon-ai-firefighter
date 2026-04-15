import type {
  ActionId,
  DegradableDependency,
  FaultScenario,
  ServiceName,
  SymptomName,
} from "@openai-hackathon/demo-contracts";

export const TRACE_NAME = "incident_investigation";

export const TRACE_TAGS = [
  "corepath-mvp",
  "checkout",
  "latency",
  "rollback",
] as const;

export const REQUIRED_OBSERVATIONS = [
  "receive_incident",
  "query_metrics_before",
  "query_logs_before",
  "fetch_deployment_annotation",
  "inspect_git_history",
  "rank_suspect_commits",
  "rank_actions",
  "simulate_rollback",
  "recommend_primary_action",
  "execute_primary_action",
  "query_metrics_after",
  "final_summary",
] as const;

export interface TraceMetadataShape {
  incidentId: string;
  service: ServiceName;
  symptom: SymptomName;
  coreJourney: ServiceName;
  degradableDependency: DegradableDependency;
  scenario: FaultScenario;
  bestFirstAction: ActionId;
  recovered: boolean;
}
