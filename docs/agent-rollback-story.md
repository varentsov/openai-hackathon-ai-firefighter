# Incident Investigation Agent: Rollback Story

This is the working story for the observability agent.

## Goal

Take an incident, investigate what likely changed, identify the most suspicious recent commit affecting the recommendations dependency, simulate where a rollback would land, and return a safe operator-facing recommendation.

The agent is not expected to mutate git history automatically in the MVP. It should:

- investigate,
- identify a suspect commit,
- show the rollback target,
- produce a dry-run style rollback recommendation,
- optionally execute the business-safe mitigation `disable_recommendations`.

## Story shape

The demo incident starts red:

- service: `checkout`
- symptom: `p95_latency_high`
- likely pressure point: `recommendations`
- recent evidence: a deployment annotation within the last 30 minutes

The investigation then adds a second line of evidence:

- git history contains a recent faulty commit in the recommendations path,
- the commit increased latency risk,
- a rollback to the previous good sha is plausible and reversible.

## Inputs

The agent should accept a structured input like:

```json
{
  "incidentId": "inc_checkout_recs_001",
  "service": "checkout",
  "symptom": "p95_latency_high",
  "startedAt": "2026-04-15T10:12:00Z",
  "severity": "sev2"
}
```

## Expected reasoning policy

The agent should prefer:

1. protecting checkout conversion,
2. reversible actions,
3. actions supported by current metrics,
4. deployment correlation as supporting evidence, not sole proof.

The agent should avoid:

- broad RCA narration,
- inventing unavailable remediations,
- pretending rollback has already executed when only simulated,
- choosing worker scaling before graceful degradation when recommendations is clearly degradable.

## Investigation steps

1. Read the incident.
2. Pull the current metric snapshot.
3. Pull the latest deployment annotation.
4. Inspect recent git history for the affected area.
5. Rank suspect commits.
6. Simulate rollback against the top suspect.
7. Rank operator actions.
8. Return a concise recommendation and trace it.

## Action ranking for this story

The ranked action list should remain stable:

1. `disable_recommendations`
2. `rollback_canary`
3. `scale_workers`

Only the first action is executable in the MVP. The rollback action remains recommendation-only, but the agent should still compute and return:

- suspect sha,
- rollback target sha,
- rollback confidence,
- rollback rationale.

## Required response shape

The structured investigation output should include:

```json
{
  "severity": "sev2",
  "why": "Checkout latency is elevated and recommendations latency regressed immediately after a recent deployment.",
  "pressurePoint": "recommendations",
  "bestFirstAction": "disable_recommendations",
  "nextActions": [
    "rollback_canary",
    "scale_workers"
  ],
  "suspectCommit": {
    "sha": "7f3c2ab",
    "summary": "Enable synchronous recommendation enrichment in checkout path",
    "confidence": 0.86
  },
  "rollbackPlan": {
    "targetSha": "3de91f0",
    "mode": "dry_run",
    "expectedOutcome": "Restores pre-regression checkout request path while preserving current payment logic."
  }
}
```

## Demo acceptance path

For the live demo, the agent run should tell a coherent story:

1. Metrics show checkout is red and recommendations is unhealthy.
2. A fresh deployment annotation points to the risky window.
3. Git history reveals a suspicious recommendations-related commit.
4. The agent computes where rollback would land.
5. The agent still recommends `disable_recommendations` first because it is safer and faster.
6. After the action, checkout recovers while the optional feature remains degraded.

## Handoff to the other engineers

The backend and UI teams can treat this story as contract input:

- mocked data stream team can supply the metric and annotation shapes,
- UI prototype team can render the suspect commit and rollback card beside the ranked action list,
- observability work can trace the full run in Langfuse using the contract in the adjacent doc.
- the typed mock fixture now lives in [src/data/incidentRollbackScenario.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/data/incidentRollbackScenario.ts).
