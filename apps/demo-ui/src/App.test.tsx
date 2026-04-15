import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "./App";

const demoState = {
  incident: {
    id: "inc_checkout_recs_001",
    service: "checkout",
    symptom: "p95_latency_high",
    startedAt: "2026-04-15T10:12:00Z",
    severity: "sev2",
    status: "investigating",
  },
  configSummary: {
    coreJourney: "checkout",
    degradableDependencies: ["recommendations", "reviews", "personalization"],
    leverIds: ["disable_recommendations", "rollback_canary", "scale_workers"],
  },
  beforeAvailable: true,
  afterAvailable: true,
  recommendationsEnabled: true,
  architectureReferences: [
    "design-draft.md",
    "mock-sre-lab/PLAN.md",
    "docs/langfuse-observability-contract.md",
  ],
};

const analysis = {
  severity: "sev2",
  why: "Recommendations are consuming checkout budget.",
  pressurePoint: "recommendations",
  bestFirstAction: {
    id: "disable_recommendations",
    title: "Disable recommendations",
    reason: "Optional dependency is the direct pressure point.",
    expectedTradeoff: "Personalization drops while checkout recovers.",
    priorityScore: 96,
    reversible: true,
    executable: true,
    approved: false,
    executed: false,
  },
  nextActions: [
    {
      id: "rollback_canary",
      title: "Rollback canary",
      reason: "Follow up if the primary lever is insufficient.",
      expectedTradeoff: "Slower operator move.",
      priorityScore: 82,
      reversible: true,
      executable: false,
      approved: false,
      executed: false,
    },
  ],
  metrics: {
    before: {
      timestamp: "2026-04-15T10:18:00Z",
      checkoutP95Ms: 1840,
      checkoutErrorRate: 0.038,
      recommendationsP95Ms: 2210,
      recommendationsErrorRate: 0.094,
      requestVolumeRps: 410,
      workerSaturation: 0.82,
    },
  },
  logs: [
    {
      timestamp: "2026-04-15T10:17:09Z",
      level: "error",
      service: "checkout",
      route: "/api/v1/checkout",
      message: "Synchronous recommendations call timed out after 1800ms",
      scenario: "payment_timeout",
      requestId: "req-102",
      traceId: "trace-before-102",
      commitSha: "7f3c2ab",
    },
  ],
  commits: [],
  suspectCommit: {
    sha: "7f3c2ab",
    timestamp: "2026-04-15T10:07:12Z",
    author: "engineer-a",
    summary: "Enable synchronous recommendation enrichment in checkout path",
    area: "recommendations",
    risk: "high",
    suspectScore: 0.86,
    rollbackTarget: "3de91f0",
  },
  rollbackPlan: {
    targetSha: "3de91f0",
    mode: "dry_run",
    expectedOutcome: "Restores the last pre-regression checkout path.",
    confidence: 0.86,
  },
  annotation: {
    id: "deploy_annot_20260415_1010",
    service: "checkout",
    timestamp: "2026-04-15T10:10:00Z",
    type: "deployment",
    summary: "Canary deployed for checkout recommendations enrichment update",
    commitSha: "7f3c2ab",
  },
  traceId: "trace-123",
};

const execution = {
  action: "disable_recommendations",
  result: "executed",
  metrics: {
    after: {
      timestamp: "2026-04-15T10:24:00Z",
      checkoutP95Ms: 540,
      checkoutErrorRate: 0.011,
      recommendationsP95Ms: 0,
      recommendationsErrorRate: 1,
      requestVolumeRps: 406,
      workerSaturation: 0.49,
    },
  },
  logs: [],
  recovered: true,
  summary: "Core path stabilized.",
  traceId: "trace-123",
};

const traces = {
  mode: "configured_in_memory",
  events: [
    {
      traceId: "trace-123",
      step: "receive_incident",
      inputSummary: "incident accepted",
      outputSummary: "analysis started",
      timestamp: "2026-04-15T10:19:00Z",
    },
  ],
  requiredObservations: ["metrics", "logs", "deploys"],
};

function mockJsonResponse(payload: unknown, ok = true): Promise<Response> {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Internal Server Error",
    json: async () => payload,
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

it("renders the booted incident shell from demo state", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(() => mockJsonResponse(demoState));

  render(<App />);

  expect(await screen.findByText("Checkout latency degradation")).toBeInTheDocument();
  expect(screen.getByText(/Protect checkout, degrade the optional edge/i)).toBeInTheDocument();
  expect(screen.getByText("design-draft.md")).toBeInTheDocument();
});

it("loads analysis and traces after Analyze", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => mockJsonResponse(demoState))
    .mockImplementationOnce(() => mockJsonResponse(analysis))
    .mockImplementationOnce(() => mockJsonResponse(traces));

  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: /analyze incident/i }));

  expect(await screen.findByText("Disable recommendations")).toBeInTheDocument();
  expect(screen.getByText(/Synchronous recommendations call timed out/i)).toBeInTheDocument();
  expect(screen.getByText(/receive incident/i)).toBeInTheDocument();
});

it("transitions to mitigated state after execution", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => mockJsonResponse(demoState))
    .mockImplementationOnce(() => mockJsonResponse(analysis))
    .mockImplementationOnce(() => mockJsonResponse(traces))
    .mockImplementationOnce(() => mockJsonResponse(execution))
    .mockImplementationOnce(() => mockJsonResponse(traces));

  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: /analyze incident/i }));
  await screen.findByText(/Optional dependency is the direct pressure point/i);

  fireEvent.click(screen.getByRole("button", { name: /^disable recommendations$/i }));

  expect(await screen.findByRole("heading", { name: /Core path stabilized/i })).toBeInTheDocument();
  expect(screen.getByText(/540ms/i)).toBeInTheDocument();
});

it("surfaces recoverable errors when analysis fails", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(() => mockJsonResponse(demoState))
    .mockImplementationOnce(() => mockJsonResponse({ error: "boom" }, false));

  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: /analyze incident/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Request interrupted.");
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /analyze incident/i })).toBeEnabled();
  });
});
