import assert from "node:assert/strict";
import test from "node:test";

import { createAppContext, routeRequest } from "./server.js";

test("HTTP API serves demo state, analysis, execution, and traces", async () => {
  const context = createAppContext();

  const demoState = await invokeRoute("/api/demo-state", "GET", context);
  const analysis = await invokeRoute("/api/analyze", "POST", context);
  const execution = await invokeRoute(
    "/api/actions/disable-recommendations",
    "POST",
    context,
  );
  const traces = await invokeRoute("/api/traces", "GET", context);
  const dashboard = await invokeRoute("/", "GET", context);

  assert.equal(demoState.statusCode, 200);
  assert.equal(demoState.json.incident.service, "checkout");
  assert.equal(Array.isArray(demoState.json.architectureReferences), true);

  assert.equal(analysis.statusCode, 200);
  assert.equal(analysis.json.bestFirstAction.id, "disable_recommendations");

  assert.equal(execution.statusCode, 200);
  assert.equal(execution.json.recovered, true);

  assert.equal(traces.statusCode, 200);
  assert.equal(traces.json.events.length >= 1, true);

  assert.equal(dashboard.statusCode, 200);
  assert.equal(dashboard.text.includes("<!doctype html>"), true);
});

interface MockRouteResult {
  statusCode: number;
  headers: Record<string, string>;
  text: string;
  json: any;
}

async function invokeRoute(pathname: string, method: string, context: ReturnType<typeof createAppContext>): Promise<MockRouteResult> {
  const request = {
    method,
    url: pathname,
  } as any;

  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = "";

  const response = {
    writeHead(code: number, nextHeaders: Record<string, string>) {
      statusCode = code;
      headers = nextHeaders;
      return this;
    },
    end(payload?: string | Buffer) {
      if (payload) {
        body += payload.toString();
      }
      return this;
    },
  } as any;

  await routeRequest(request, response, context);

  return {
    statusCode,
    headers,
    text: body,
    json: headers["content-type"]?.includes("application/json") ? JSON.parse(body) : null,
  };
}
