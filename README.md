# openai-hackathon-ai-firefighter

CorePath MVP workspace for a single-scenario incident demo: checkout latency degradation caused by the recommendations dependency.

## Current repo focus

This repo now includes a working mock-first incident investigation slice:

- Langfuse CLI setup notes and a repo-local environment template.
- A workspace-based Node 22 API plus a React operator console in `apps/demo-ui`.
- A concrete incident-investigation agent contract for the rollback story.
- TypeScript scenario fixtures, adapters, traces, and tests for the rollback flow.
- Architecture references merged from the fetched `main` branch planning docs.

## Files to start with

- [docs/langfuse-cli-getting-started.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/docs/langfuse-cli-getting-started.md)
- [docs/langfuse-observability-contract.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/docs/langfuse-observability-contract.md)
- [docs/agent-rollback-story.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/docs/agent-rollback-story.md)
- [docs/architecture-merge.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/docs/architecture-merge.md)
- [design-draft.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/design-draft.md)
- [mock-sre-lab/PLAN.md](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/mock-sre-lab/PLAN.md)
- [apps/demo-ui/src/App.tsx](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/apps/demo-ui/src/App.tsx)
- [apps/demo-ui/src/styles.css](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/apps/demo-ui/src/styles.css)
- [packages/demo-contracts/src/index.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/packages/demo-contracts/src/index.ts)
- [src/data/incidentRollbackScenario.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/data/incidentRollbackScenario.ts)
- [src/contracts/observability.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/contracts/observability.ts)
- [src/index.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/index.ts)
- [src/server.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/server.ts)
- [src/agent/agentOrchestrator.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/agent/agentOrchestrator.ts)
- [src/adapters/mockDataAdapter.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/adapters/mockDataAdapter.ts)
- [src/adapters/langfuseAdapter.ts](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/src/adapters/langfuseAdapter.ts)
- [.env.example](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/.env.example)
- [tsconfig.json](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/tsconfig.json)

## Run It

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

`npm run dev` starts the API and Vite UI together. `npm run start` serves the built UI from the backend.

## Verify It

```bash
npm run typecheck
npm run test
npm run build
```

## Notes

- The repo stays mock-first for the MVP, but now exposes real API routes and a built React operator console.
- Langfuse tracing is optional and remains off the critical path; the current implementation keeps a Langfuse-shaped in-memory trace timeline.
- The agent is scoped to business-preserving graceful degradation and rollback guidance, not full RCA.
- The fetched `main` branch docs are preserved and linked into the merged architecture note so the current app can later attach to the larger sandbox plan.
