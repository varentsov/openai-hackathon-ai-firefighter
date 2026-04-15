import { randomUUID } from "node:crypto";

import type { RunTraceEvent } from "@openai-hackathon/demo-contracts";

import { TRACE_NAME, TRACE_TAGS, type TraceMetadataShape } from "../contracts/observability.js";

interface TraceSession {
  traceId: string;
  name: string;
  metadata: TraceMetadataShape;
  tags: readonly string[];
  events: RunTraceEvent[];
  status: "open" | "finished";
  finalSummary?: string;
}

export class InMemoryLangfuseAdapter {
  private readonly traces = new Map<string, TraceSession>();

  startTrace(metadata: TraceMetadataShape): string {
    const traceId = randomUUID();

    this.traces.set(traceId, {
      traceId,
      name: TRACE_NAME,
      metadata,
      tags: TRACE_TAGS,
      events: [],
      status: "open",
    });

    return traceId;
  }

  recordStep(
    traceId: string,
    step: string,
    inputSummary: string,
    outputSummary: string,
  ): void {
    const trace = this.traces.get(traceId);

    if (!trace) {
      throw new Error(`Trace ${traceId} does not exist`);
    }

    trace.events.push({
      traceId,
      step,
      inputSummary,
      outputSummary,
      timestamp: new Date().toISOString(),
    });
  }

  finishTrace(traceId: string, finalSummary: string): void {
    const trace = this.traces.get(traceId);

    if (!trace) {
      return;
    }

    trace.status = "finished";
    trace.finalSummary = finalSummary;
  }

  getTrace(traceId: string): TraceSession | undefined {
    const trace = this.traces.get(traceId);

    return trace ? structuredClone(trace) : undefined;
  }

  listEvents(traceId?: string): RunTraceEvent[] {
    if (traceId) {
      return this.getTrace(traceId)?.events ?? [];
    }

    return Array.from(this.traces.values())
      .flatMap((trace) => trace.events)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  getMode(): "disabled" | "configured_in_memory" {
    return this.isConfigured() ? "configured_in_memory" : "disabled";
  }

  isConfigured(): boolean {
    return Boolean(
      process.env.LANGFUSE_PUBLIC_KEY &&
        process.env.LANGFUSE_SECRET_KEY &&
        (process.env.LANGFUSE_BASE_URL ?? process.env.LANGFUSE_HOST),
    );
  }
}
