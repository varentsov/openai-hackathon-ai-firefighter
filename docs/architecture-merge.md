# Merged Architecture

This document merges the planning direction from [design-draft.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/design-draft.md) and [mock-sre-lab/PLAN.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/mock-sre-lab/PLAN.md) with the current TypeScript implementation in `src/`.

## What Exists Now

The current working app is a single local Node 22 process:

- `GET /` serves a one-page operator console.
- `POST /api/analyze` runs the incident investigation against typed mock data.
- `POST /api/actions/disable-recommendations` executes the only live mitigation.
- `GET /api/traces` exposes the in-memory Langfuse-shaped trace timeline for the run.

The current code path is:

```text
UI -> server.ts -> AgentOrchestrator -> MockDataAdapter + InMemoryLangfuseAdapter
```

## How It Incorporates The Fetched Main Branch

The fetched `main` branch added two planning documents:

- `design-draft.md` emphasized metrics, logs, commits, deploy events, and an RCA-style report.
- `mock-sre-lab/PLAN.md` described a larger local observability sandbox with Prometheus, Grafana, Loki, Tempo, Alloy, and GlitchTip.

The current TS app merges those ideas in a hackathon-safe way:

- from `design-draft.md`: the analysis flow now returns metrics, logs, deployment annotation, recent commits, suspect commit, rollback plan, ranked actions, and a final operator summary.
- from `mock-sre-lab/PLAN.md`: the app keeps explicit adapter boundaries so Prometheus/log/trace backends can later replace the mock data layer without rewriting the UI or orchestration path.

## Current Runtime Layout

```text
[ Browser UI ]
   -> GET /
   -> POST /api/analyze
   -> POST /api/actions/disable-recommendations
   -> GET /api/traces

[ Node 22 TS App ]
   -> server.ts
   -> agent/agentOrchestrator.ts
   -> adapters/mockDataAdapter.ts
   -> adapters/langfuseAdapter.ts
   -> data/incidentRollbackScenario.ts

[ Future External Signals ]
   -> mock-sre-lab app metrics
   -> log search backend
   -> deploy annotations
   -> git history
   -> Langfuse project
```

## Why This Merge Is Useful

- The current branch had the CorePath business-preserving incident story and typed rollback scenario.
- `main` had better cross-system architecture framing.
- The merged result keeps the current repo runnable today while leaving obvious seams for the sandbox the team may add next.

## Next Integration Target

When the mock SRE lab lands, replace `MockDataAdapter` with a real signal adapter that reads:

- Prometheus query windows,
- structured log snippets,
- deployment events,
- git history,
- optional Langfuse/OpenAI metadata.

The UI and orchestrator contracts should remain stable when that swap happens.
