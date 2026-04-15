import type {
  AnalyzeResponse,
  DemoStateResponse,
  ExecuteResponse,
  RunTraceEvent,
} from "@openai-hackathon/demo-contracts";

export interface TraceResponse {
  mode: "disabled" | "configured_in_memory";
  events: RunTraceEvent[];
  requiredObservations: readonly string[];
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const message = `${response.status} ${response.statusText}`.trim();
    throw new Error(message || "Request failed");
  }

  return (await response.json()) as T;
}

export function getDemoState(): Promise<DemoStateResponse> {
  return requestJson<DemoStateResponse>("/api/demo-state");
}

export function analyzeIncident(): Promise<AnalyzeResponse> {
  return requestJson<AnalyzeResponse>("/api/analyze", {
    method: "POST",
  });
}

export function executeDisableRecommendations(): Promise<ExecuteResponse> {
  return requestJson<ExecuteResponse>("/api/actions/disable-recommendations", {
    method: "POST",
  });
}

export function getTraces(): Promise<TraceResponse> {
  return requestJson<TraceResponse>("/api/traces");
}
