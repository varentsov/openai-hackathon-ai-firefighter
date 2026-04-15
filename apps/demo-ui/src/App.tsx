import { useEffect, useReducer, type ReactElement } from "react";

import type {
  AnalyzeResponse,
  DemoStateResponse,
  ExecuteResponse,
  LogEvent,
  RankedAction,
  RunTraceEvent,
  Severity,
} from "@openai-hackathon/demo-contracts";

import {
  analyzeIncident,
  executeDisableRecommendations,
  getDemoState,
  getTraces,
  type TraceResponse,
} from "./lib/api";

type Phase =
  | "booting"
  | "ready"
  | "analyzing"
  | "analyzed"
  | "executing"
  | "mitigated"
  | "error";

interface AppState {
  phase: Phase;
  previousPhase?: Exclude<Phase, "booting" | "error">;
  demoState?: DemoStateResponse;
  analysis?: AnalyzeResponse;
  execution?: ExecuteResponse;
  traces: RunTraceEvent[];
  traceMode?: TraceResponse["mode"];
  requiredObservations: readonly string[];
  errorMessage?: string;
}

type Action =
  | { type: "boot_success"; payload: DemoStateResponse }
  | { type: "boot_error"; payload: string }
  | { type: "analysis_start" }
  | { type: "analysis_success"; payload: AnalyzeResponse }
  | { type: "execute_start" }
  | { type: "execute_success"; payload: ExecuteResponse }
  | { type: "traces_success"; payload: TraceResponse }
  | { type: "request_error"; payload: string };

const initialState: AppState = {
  phase: "booting",
  traces: [],
  requiredObservations: [],
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "boot_success":
      return {
        ...state,
        phase: action.payload.recommendationsEnabled ? "ready" : "mitigated",
        previousPhase: action.payload.recommendationsEnabled ? "ready" : "mitigated",
        demoState: action.payload,
        errorMessage: undefined,
      };
    case "boot_error":
      return {
        ...state,
        phase: "error",
        errorMessage: action.payload,
      };
    case "analysis_start":
      return {
        ...state,
        phase: "analyzing",
        previousPhase: getStablePhase(state),
        errorMessage: undefined,
      };
    case "analysis_success":
      return {
        ...state,
        phase: "analyzed",
        previousPhase: "analyzed",
        analysis: action.payload,
        execution: undefined,
        errorMessage: undefined,
      };
    case "execute_start":
      return {
        ...state,
        phase: "executing",
        previousPhase: getStablePhase(state),
        errorMessage: undefined,
      };
    case "execute_success":
      return {
        ...state,
        phase: "mitigated",
        previousPhase: "mitigated",
        execution: action.payload,
        demoState: state.demoState
          ? {
              ...state.demoState,
              incident: {
                ...state.demoState.incident,
                status: action.payload.recovered ? "mitigated" : state.demoState.incident.status,
              },
              recommendationsEnabled: false,
            }
          : state.demoState,
        errorMessage: undefined,
      };
    case "traces_success":
      return {
        ...state,
        traces: action.payload.events,
        traceMode: action.payload.mode,
        requiredObservations: action.payload.requiredObservations,
      };
    case "request_error":
      return {
        ...state,
        phase: "error",
        previousPhase: getStablePhase(state),
        errorMessage: action.payload,
      };
    default:
      return state;
  }
}

function getStablePhase(state: AppState): Exclude<Phase, "booting" | "error"> {
  if (state.phase === "mitigated") {
    return "mitigated";
  }

  if (state.phase === "analyzed" || state.phase === "executing") {
    return "analyzed";
  }

  return "ready";
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatSeverityLabel(severity: Severity): string {
  return severity.toUpperCase();
}

function metricDelta(before: number, after?: number, unit = ""): string {
  if (after === undefined) {
    return "Awaiting mitigation";
  }

  const delta = after - before;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(0)}${unit} after action`;
}

function statusTone(phase: Phase): "alert" | "active" | "resolved" {
  if (phase === "mitigated") {
    return "resolved";
  }

  if (phase === "analyzing" || phase === "executing") {
    return "active";
  }

  return "alert";
}

function App(): ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState);
  const visiblePhase = state.phase === "error" ? state.previousPhase ?? "ready" : state.phase;

  useEffect(() => {
    let cancelled = false;

    getDemoState()
      .then((payload) => {
        if (!cancelled) {
          dispatch({ type: "boot_success", payload });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Failed to load demo state";
          dispatch({ type: "boot_error", payload: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshTraces(): Promise<void> {
    const payload = await getTraces();
    dispatch({ type: "traces_success", payload });
  }

  async function handleAnalyze(): Promise<void> {
    dispatch({ type: "analysis_start" });

    try {
      const payload = await analyzeIncident();
      dispatch({ type: "analysis_success", payload });
      await refreshTraces();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      dispatch({ type: "request_error", payload: message });
    }
  }

  async function handleExecute(): Promise<void> {
    dispatch({ type: "execute_start" });

    try {
      const payload = await executeDisableRecommendations();
      dispatch({ type: "execute_success", payload });
      await refreshTraces();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Execution failed";
      dispatch({ type: "request_error", payload: message });
    }
  }

  const demoState = state.demoState;
  const incident = demoState?.incident;
  const analysis = state.analysis;
  const execution = state.execution;
  const currentMetrics = execution?.metrics.after ?? analysis?.metrics.before;
  const actions = analysis ? [analysis.bestFirstAction, ...analysis.nextActions] : [];
  const statusText = execution?.summary ?? analysis?.why ?? "Run the investigation to rank the next action.";

  return (
    <main className={`app-shell tone-${statusTone(state.phase)}`}>
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow-row">
            <span className={`status-pill status-pill-${incident?.severity ?? "sev2"}`}>
              {incident ? formatSeverityLabel(incident.severity) : "LOADING"}
            </span>
            <span className="eyebrow-text">
              {incident
                ? `${incident.service} / ${incident.symptom} / started ${formatTimestamp(incident.startedAt)}`
                : "Loading incident briefing"}
            </span>
          </div>
          <h1>Checkout latency degradation</h1>
          <p className="hero-summary">
            Recommendations are pulling the protected journey out of budget while the recent
            deploy window remains the primary suspect.
          </p>
        </div>
        <div className="hero-actions">
          <button
            className="primary-button"
            onClick={() => void handleAnalyze()}
            disabled={state.phase === "booting" || state.phase === "analyzing" || state.phase === "executing"}
          >
            {state.phase === "analyzing" ? "Analyzing..." : "Analyze incident"}
          </button>
          <button
            className="secondary-button"
            onClick={() => void handleExecute()}
            disabled={!analysis || state.phase === "analyzing" || state.phase === "executing"}
          >
            {state.phase === "executing" ? "Applying..." : "Disable recommendations"}
          </button>
        </div>
      </section>

      {state.errorMessage ? (
        <section className="inline-alert" role="alert">
          <strong>Request interrupted.</strong> {state.errorMessage}
        </section>
      ) : null}

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="section-label">CorePath Stance</div>
          <h2>Protect checkout, degrade the optional edge.</h2>
          <p className="muted-copy">
            {demoState
              ? `${demoState.configSummary.coreJourney} is the protected journey. ${demoState.configSummary.degradableDependencies.join(", ")} stay degradable before higher-risk operator moves.`
              : "Loading protected-journey policy."}
          </p>
          <div className="chip-row">
            {(demoState?.configSummary.leverIds ?? []).map((lever) => (
              <span key={lever} className="chip">
                {lever.replaceAll("_", " ")}
              </span>
            ))}
          </div>
        </article>

        <article className="panel-card">
          <div className="section-label">Reference Trail</div>
          <h2>Design and architecture context</h2>
          <p className="muted-copy">
            Keep the demo anchored in the current incident story, the mock SRE lab direction, and
            the observability contract.
          </p>
          <div className="reference-list">
            {(demoState?.architectureReferences ?? []).map((reference) => (
              <span key={reference} className="reference-chip">
                {reference}
              </span>
            ))}
          </div>
        </article>
      </section>

      <section className="metrics-strip">
        <MetricCard
          label="Checkout P95"
          value={currentMetrics ? `${formatNumber(currentMetrics.checkoutP95Ms)}ms` : "--"}
          detail={
            analysis
              ? metricDelta(analysis.metrics.before.checkoutP95Ms, execution?.metrics.after.checkoutP95Ms, "ms")
              : "Snapshot appears after analysis"
          }
          tone={execution ? "resolved" : "alert"}
        />
        <MetricCard
          label="Checkout Error Rate"
          value={currentMetrics ? formatPercent(currentMetrics.checkoutErrorRate) : "--"}
          detail={
            analysis
              ? execution
                ? `${formatPercent(execution.metrics.after.checkoutErrorRate)} after action`
                : "Awaiting mitigation"
              : "Snapshot appears after analysis"
          }
          tone={execution ? "resolved" : "alert"}
        />
        <MetricCard
          label="Recommendations P95"
          value={currentMetrics ? `${formatNumber(currentMetrics.recommendationsP95Ms)}ms` : "--"}
          detail={
            analysis
              ? execution
                ? "Gracefully bypassed after mitigation"
                : "Still on the checkout path"
              : "Snapshot appears after analysis"
          }
          tone={execution ? "resolved" : "active"}
        />
        <MetricCard
          label="Worker Saturation"
          value={currentMetrics ? formatPercent(currentMetrics.workerSaturation) : "--"}
          detail={
            analysis
              ? execution
                ? `${formatPercent(execution.metrics.after.workerSaturation)} after action`
                : "Secondary signal"
              : "Snapshot appears after analysis"
          }
          tone={execution ? "resolved" : "active"}
        />
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="section-label">Ranked Actions</div>
          <h2>Best next move</h2>
          <div className="stack-list">
            {actions.length ? (
              actions.map((action, index) => (
                <ActionCard
                  key={action.id}
                  action={action}
                  rank={index + 1}
                  highlighted={index === 0}
                />
              ))
            ) : (
              <EmptyState
                title="Investigation not started"
                body="Run Analyze to correlate metrics, logs, and deploy evidence before taking action."
              />
            )}
          </div>
        </article>

        <article className="panel-card">
          <div className="section-label">Evidence</div>
          <h2>Deploy window and rollback path</h2>
          {analysis ? (
            <div className="evidence-stack">
              <EvidenceBlock label="Deploy annotation" body={analysis.annotation.summary} />
              <EvidenceBlock
                label="Suspect commit"
                body={`${analysis.suspectCommit.sha} · ${analysis.suspectCommit.summary}`}
              />
              <EvidenceBlock
                label="Rollback target"
                body={`${analysis.rollbackPlan.targetSha} · ${analysis.rollbackPlan.expectedOutcome}`}
              />
              <div className="log-stack">
                {analysis.logs.map((log) => (
                  <LogLine key={`${log.traceId}-${log.timestamp}`} event={log} />
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              title="Evidence will populate here"
              body="The investigation keeps metrics and context quiet until the operator explicitly starts analysis."
            />
          )}
        </article>
      </section>

      <section className="panel-grid panel-grid-two">
        <article className="panel-card">
          <div className="section-label">Outcome</div>
          <h2>{visiblePhase === "mitigated" ? "Core path stabilized" : "Investigation summary"}</h2>
          <p className="summary-callout">{statusText}</p>
          {analysis ? (
            <div className="summary-grid">
              <SummaryStat label="Pressure point" value={analysis.pressurePoint} />
              <SummaryStat label="Trace mode" value={state.traceMode ?? "pending"} />
              <SummaryStat
                label="Current incident state"
                value={demoState?.incident.status ?? "investigating"}
              />
            </div>
          ) : null}
        </article>

        <article className="panel-card">
          <div className="section-label">Trace Timeline</div>
          <h2>Agent reasoning path</h2>
          {state.traces.length ? (
            <ol className="trace-list">
              {state.traces.map((event) => (
                <li key={`${event.traceId}-${event.step}-${event.timestamp}`} className="trace-item">
                  <div className="trace-step">{event.step.replaceAll("_", " ")}</div>
                  <div className="trace-meta">{formatTimestamp(event.timestamp)}</div>
                  <p>{event.inputSummary}</p>
                  <p className="muted-copy">{event.outputSummary}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No trace events yet"
              body="Trace events load after Analyze and refresh after the mitigation action."
            />
          )}
          <div className="observation-strip">
            {state.requiredObservations.map((item) => (
              <span key={item} className="chip chip-subtle">
                {item}
              </span>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "alert" | "active" | "resolved";
}): ReactElement {
  return (
    <article className={`metric-card metric-card-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </article>
  );
}

function ActionCard({
  action,
  rank,
  highlighted,
}: {
  action: RankedAction;
  rank: number;
  highlighted: boolean;
}): ReactElement {
  return (
    <article className={`action-card${highlighted ? " action-card-highlighted" : ""}`}>
      <div className="action-header">
        <span className="action-rank">#{rank}</span>
        <strong>{action.title}</strong>
      </div>
      <p>{action.reason}</p>
      <p className="muted-copy">Tradeoff: {action.expectedTradeoff}</p>
    </article>
  );
}

function EvidenceBlock({ label, body }: { label: string; body: string }): ReactElement {
  return (
    <div className="evidence-block">
      <div className="evidence-label">{label}</div>
      <div>{body}</div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="summary-stat">
      <div className="summary-label">{label}</div>
      <div className="summary-value">{value}</div>
    </div>
  );
}

function LogLine({ event }: { event: LogEvent }): ReactElement {
  return (
    <article className={`log-line log-line-${event.level}`}>
      <div className="log-line-top">
        <strong>{event.level.toUpperCase()}</strong>
        <span>{formatTimestamp(event.timestamp)}</span>
      </div>
      <p>{event.message}</p>
      <div className="muted-copy">
        {event.route} · {event.requestId} · {event.commitSha ?? "no commit tag"}
      </div>
    </article>
  );
}

function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export { App };
