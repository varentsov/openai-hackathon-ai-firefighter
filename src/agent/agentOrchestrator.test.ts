import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryLangfuseAdapter } from "../adapters/langfuseAdapter.js";
import { MockDataAdapter } from "../adapters/mockDataAdapter.js";
import { AgentOrchestrator } from "./agentOrchestrator.js";

test("analyzeIncident ranks graceful degradation first and surfaces the suspect commit", async () => {
  const orchestrator = new AgentOrchestrator({
    dataAdapter: new MockDataAdapter(),
    langfuseAdapter: new InMemoryLangfuseAdapter(),
  });

  const analysis = await orchestrator.analyzeIncident();

  assert.equal(analysis.pressurePoint, "recommendations");
  assert.equal(analysis.bestFirstAction.id, "disable_recommendations");
  assert.equal(analysis.suspectCommit.sha, "7f3c2ab");
  assert.equal(analysis.rollbackPlan.targetSha, "3de91f0");
  assert.equal(analysis.logs.length > 0, true);
  assert.equal(analysis.commits.length, 3);
});

test("executeDisableRecommendations appends recovery trace steps and returns healthy after metrics", async () => {
  const orchestrator = new AgentOrchestrator({
    dataAdapter: new MockDataAdapter(),
    langfuseAdapter: new InMemoryLangfuseAdapter(),
  });

  const analysis = await orchestrator.analyzeIncident();
  const execution = await orchestrator.executeDisableRecommendations();
  const traceSteps = orchestrator.getTraceEvents(analysis.traceId).map((event) => event.step);

  assert.equal(execution.result, "executed");
  assert.equal(execution.recovered, true);
  assert.equal(execution.metrics.after.checkoutP95Ms, 540);
  assert.equal(traceSteps.includes("execute_primary_action"), true);
  assert.equal(traceSteps.includes("final_summary"), true);
});
