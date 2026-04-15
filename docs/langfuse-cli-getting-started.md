# Langfuse CLI Getting Started

This repo uses Langfuse in two different ways:

- runtime tracing from the incident-investigation agent into Langfuse,
- operator and developer inspection of traces through the Langfuse CLI.

The CLI is useful even before the full backend is wired up because it gives the team a stable way to inspect traces and verify naming/metadata conventions.

## What to install

Use the Langfuse CLI directly with `npx`:

```bash
npx langfuse --help
```

The installed package is `langfuse-cli`, but the executable it exposes is `langfuse`. Start with the top-level help, then drill into `api`.

If you prefer local install semantics, add it as a dev dependency:

```bash
npm install -D langfuse-cli
```

Then run:

```bash
npx langfuse api help
```

## Repo-local environment file

Create a dedicated Langfuse env file:

```bash
cp .env.example .env.langfuse
```

Fill in:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Use `https://us.cloud.langfuse.com` for Langfuse US Cloud, or your self-hosted base URL.

## First commands to run

```bash
npm run langfuse:help
npm run langfuse:api:help
npm run langfuse:traces:curl
```

The second command previews the generated API call without executing it. That is the safest first check when credentials or endpoint selection may still be wrong.

Once tracing is active in the app, inspect recent traces:

```bash
npm run langfuse:traces
```

## Discovery workflow

Use the CLI progressively:

```bash
langfuse --help
langfuse api help
langfuse api traces --help
langfuse api traces list --help
langfuse --env .env.langfuse api traces list --limit 10
```

This is the intended usage pattern from the Langfuse CLI release notes.

## How this repo should use Langfuse

The agent flow for this MVP should emit one incident trace with nested observations for:

1. incident intake
2. metrics fetch
3. deployment annotation lookup
4. git-history inspection
5. suspect commit ranking
6. rollback simulation
7. final action recommendation

Keep the trace schema stable so the CLI remains useful during the demo:

- `trace.name`: `incident_investigation`
- `trace.sessionId`: incident id
- `trace.tags`: `checkout`, `rollback`, `corepath-mvp`
- `trace.metadata.incidentId`
- `trace.metadata.service`
- `trace.metadata.symptom`
- `trace.metadata.recommendedAction`

## Recommended working loop

1. Run the app locally with Langfuse env vars set.
2. Trigger the incident analysis once.
3. Use the CLI to inspect the resulting trace.
4. Verify the expected observations and metadata are present.
5. Adjust trace naming before UI polish starts.

## Current repo scripts

Defined in [package.json](/Users/carldiederichs/code/projects/openai-hackathon-ai-firefighter/package.json):

- `npm run langfuse:help`
- `npm run langfuse:api:help`
- `npm run langfuse:traces`
- `npm run langfuse:traces:curl`

## MVP guardrails

- Langfuse must never block the analysis flow.
- Tracing failures should be logged locally and swallowed.
- CLI usage is for visibility and debugging, not as a runtime dependency of the user-facing app.
