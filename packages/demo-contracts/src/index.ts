export type ServiceName = "checkout";
export type SymptomName = "p95_latency_high";
export type Severity = "sev1" | "sev2" | "sev3" | "sev4";
export type IncidentStatus = "investigating" | "mitigated" | "resolved";
export type FaultScenario =
  | "faulty_commit_regression"
  | "payment_timeout"
  | "db_pool_exhaustion"
  | "error_burst";
export type ActionId =
  | "disable_recommendations"
  | "rollback_canary"
  | "scale_workers";
export type DegradableDependency =
  | "recommendations"
  | "reviews"
  | "personalization";
export type SafetyLevel = "high" | "medium" | "low";
export type BusinessImpact = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";
export type LogLevel = "info" | "warn" | "error";
export type RollbackMode = "dry_run";
export type ActionResult = "executed" | "noop";

export interface Incident {
  id: string;
  service: ServiceName;
  symptom: SymptomName;
  startedAt: string;
  severity: Severity;
  status: IncidentStatus;
}

export interface Lever {
  id: ActionId;
  title: string;
  reversible: boolean;
  safety: SafetyLevel;
  businessImpact: BusinessImpact;
}

export interface CriticalityConfig {
  coreJourney: ServiceName;
  degradableDependencies: DegradableDependency[];
  levers: Lever[];
}

export interface MetricSnapshot {
  timestamp: string;
  checkoutP95Ms: number;
  checkoutErrorRate: number;
  recommendationsP95Ms: number;
  recommendationsErrorRate: number;
  requestVolumeRps: number;
  workerSaturation: number;
}

export interface MetricsByStage {
  before: MetricSnapshot;
  after: MetricSnapshot;
}

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  service: ServiceName;
  route: string;
  message: string;
  scenario: FaultScenario;
  requestId: string;
  traceId: string;
  commitSha?: string;
}

export interface LogsByStage {
  before: LogEvent[];
  after: LogEvent[];
}

export interface DeploymentAnnotation {
  id: string;
  service: ServiceName;
  timestamp: string;
  type: "deployment";
  summary: string;
  commitSha: string;
}

export interface GitHistoryEntry {
  sha: string;
  timestamp: string;
  author: string;
  summary: string;
  area: DegradableDependency | ServiceName;
  risk: RiskLevel;
  suspectScore: number;
  rollbackTarget: string;
}

export interface ExpectedAnalysis {
  pressurePoint: DegradableDependency;
  bestFirstAction: ActionId;
  suspectCommitSha: string;
  rollbackTargetSha: string;
  recoveredAfterPrimaryAction: boolean;
}

export interface RankedAction {
  id: ActionId;
  title: string;
  reason: string;
  expectedTradeoff: string;
  priorityScore: number;
  reversible: boolean;
  executable: boolean;
  approved: boolean;
  executed: boolean;
}

export interface RollbackPlan {
  targetSha: string;
  mode: RollbackMode;
  expectedOutcome: string;
  confidence: number;
}

export interface RunTraceEvent {
  traceId: string;
  step: string;
  inputSummary: string;
  outputSummary: string;
  timestamp: string;
}

export interface DemoStateResponse {
  incident: Incident;
  configSummary: {
    coreJourney: ServiceName;
    degradableDependencies: DegradableDependency[];
    leverIds: ActionId[];
  };
  beforeAvailable: boolean;
  afterAvailable: boolean;
  recommendationsEnabled: boolean;
  architectureReferences: string[];
}

export interface AnalyzeResponse {
  severity: Severity;
  why: string;
  pressurePoint: DegradableDependency;
  bestFirstAction: RankedAction;
  nextActions: RankedAction[];
  metrics: {
    before: MetricSnapshot;
  };
  logs: LogEvent[];
  commits: GitHistoryEntry[];
  suspectCommit: GitHistoryEntry;
  rollbackPlan: RollbackPlan;
  annotation: DeploymentAnnotation;
  traceId?: string;
}

export interface ExecuteResponse {
  action: ActionId;
  result: ActionResult;
  metrics: {
    after: MetricSnapshot;
  };
  logs: LogEvent[];
  recovered: boolean;
  summary: string;
  traceId?: string;
}

export interface IncidentRollbackScenario {
  incident: Incident;
  criticalityConfig: CriticalityConfig;
  metrics: MetricsByStage;
  logs: LogsByStage;
  annotation: DeploymentAnnotation;
  gitHistory: GitHistoryEntry[];
  expectedAnalysis: ExpectedAnalysis;
}
