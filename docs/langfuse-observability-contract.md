# Langfuse Observability Contract

This document defines what the incident agent should emit so traces are useful in both the Langfuse UI and the Langfuse CLI.

## Scope

The agent is not a generic AIOps assistant. It is a narrow incident-investigation agent for one story:

- checkout p95 latency is high,
- recommendations is the pressure point,
- a recent faulty change is a plausible contributing factor,
- the safest business-first action is graceful degradation or rollback guidance.

## Trace model

Emit one root trace per investigation run.

### Root trace

- `name`: `incident_investigation`
- `sessionId`: incident id
- `userId`: `operator-demo`
- `input`: incident summary and current alert fields
- `output`: final recommendation summary
- `tags`: `corepath-mvp`, `checkout`, `latency`, `rollback`

### Root trace metadata

```json
{
  "incidentId": "inc_checkout_recs_001",
  "service": "checkout",
  "symptom": "p95_latency_high",
  "coreJourney": "checkout",
  "degradableDependency": "recommendations",
  "scenario": "faulty_commit_regression",
  "bestFirstAction": "disable_recommendations",
  "recovered": true
}
```

## Required observations

Emit child observations in this order:

1. `receive_incident`
2. `query_metrics_before`
3. `fetch_deployment_annotation`
4. `inspect_git_history`
5. `rank_suspect_commits`
6. `rank_actions`
7. `simulate_rollback`
8. `execute_primary_action` or `recommend_primary_action`
9. `query_metrics_after`
10. `final_summary`

## Observation payload guidance

### `query_metrics_before`

- input: incident id, service, stage=`before`
- output: latency, error rate, request volume, worker saturation, recommendations health

### `fetch_deployment_annotation`

- input: service=`checkout`, lookback=`30m`
- output: deployment id, commit sha, actor, timestamp

### `inspect_git_history`

- input: branch, max commits scanned
- output: ordered commits with author, timestamp, scope, suspected blast radius

### `rank_suspect_commits`

- input: recent commits plus annotation
- output: sorted suspects, confidence, rollback feasibility

### `simulate_rollback`

- input: selected suspect sha
- output: target sha, expected files touched, expected risk, dry-run verdict

### `final_summary`

- output should capture:
  - why the recommendations path is implicated,
  - what reversible action is recommended first,
  - whether checkout recovered,
  - whether the optional feature remains degraded.

## Metadata fields worth querying from the CLI

At minimum, include:

```json
{
  "incidentId": "inc_checkout_recs_001",
  "suspectCommit": "7f3c2ab",
  "rollbackTarget": "3de91f0",
  "annotationCommit": "7f3c2ab",
  "pressurePoint": "recommendations",
  "severity": "sev2",
  "actionPolicy": "business_preserving_graceful_degradation"
}
```

## CLI-oriented naming rules

Use stable, grep-friendly names:

- prefer snake_case names,
- keep action names aligned with API responses,
- do not encode timestamps into trace names,
- put the incident id in metadata and session id instead of the trace name.

That makes CLI lookups predictable when the team runs commands like:

```bash
langfuse api traces list --limit 10 --env .env.langfuse
```

## Failure policy

- If Langfuse env vars are missing, tracing becomes a no-op.
- If Langfuse export fails, log one local warning and continue.
- Never fail analysis, simulation, or rollback recommendation because tracing is unavailable.
