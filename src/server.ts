import { access, readFile, stat } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MockDataAdapter } from "./adapters/mockDataAdapter.js";
import { InMemoryLangfuseAdapter } from "./adapters/langfuseAdapter.js";
import { AgentOrchestrator } from "./agent/agentOrchestrator.js";
import { renderDashboardHtml } from "./ui/renderDashboard.js";

export interface AppContext {
  dataAdapter: MockDataAdapter;
  langfuseAdapter: InMemoryLangfuseAdapter;
  orchestrator: AgentOrchestrator;
}

const uiDistDir = resolve(fileURLToPath(new URL("../apps/demo-ui/dist", import.meta.url)));

const contentTypeByExtension: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function json(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function textHtml(response: ServerResponse, statusCode: number, payload: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

function fileResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Buffer,
  contentType: string,
): void {
  response.writeHead(statusCode, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(payload);
}

async function hasBuiltUi(): Promise<boolean> {
  try {
    await access(resolve(uiDistDir, "index.html"));
    return true;
  } catch {
    return false;
  }
}

async function serveUiRequest(pathname: string, response: ServerResponse): Promise<boolean> {
  if (!(await hasBuiltUi())) {
    return false;
  }

  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const normalizedFilePath = resolve(uiDistDir, requestedPath);

  if (!normalizedFilePath.startsWith(uiDistDir)) {
    return false;
  }

  try {
    const fileInfo = await stat(normalizedFilePath);

    if (fileInfo.isFile()) {
      const content = await readFile(normalizedFilePath);
      const extension = extname(normalizedFilePath);

      fileResponse(
        response,
        200,
        content,
        contentTypeByExtension[extension] ?? "application/octet-stream",
      );

      return true;
    }
  } catch {
    if (requestedPath.includes(".")) {
      return false;
    }
  }

  const indexPath = resolve(uiDistDir, "index.html");
  const content = await readFile(indexPath, "utf-8");
  textHtml(response, 200, content);
  return true;
}

export async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: AppContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (
    method === "GET" &&
    !url.pathname.startsWith("/api/") &&
    url.pathname !== "/healthz" &&
    (await serveUiRequest(url.pathname, response))
  ) {
    return;
  }

  if (method === "GET" && url.pathname === "/") {
    textHtml(response, 200, renderDashboardHtml());
    return;
  }

  if (method === "GET" && url.pathname === "/healthz") {
    json(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/demo-state") {
    json(response, 200, context.dataAdapter.getDemoState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/analyze") {
    json(response, 200, context.orchestrator.analyzeIncident());
    return;
  }

  if (method === "POST" && url.pathname === "/api/actions/disable-recommendations") {
    json(response, 200, context.orchestrator.executeDisableRecommendations());
    return;
  }

  if (method === "GET" && url.pathname === "/api/traces") {
    json(response, 200, {
      mode: context.langfuseAdapter.getMode(),
      events: context.orchestrator.getTraceEvents(),
      requiredObservations: context.orchestrator.getRequiredObservations(),
    });
    return;
  }

  json(response, 404, {
    error: "not_found",
    path: url.pathname,
  });
}

export function createAppContext(): AppContext {
  const dataAdapter = new MockDataAdapter();
  const langfuseAdapter = new InMemoryLangfuseAdapter();
  const orchestrator = new AgentOrchestrator({
    dataAdapter,
    langfuseAdapter,
  });

  return {
    dataAdapter,
    langfuseAdapter,
    orchestrator,
  };
}

export function createAppServer(context = createAppContext()) {
  const server = createHttpServer((request, response) => {
    routeRequest(request, response, context).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown_error";

      json(response, 500, {
        error: "internal_server_error",
        message,
      });
    });
  });

  return {
    context,
    server,
  };
}

export async function startServer(
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? "127.0.0.1",
) {
  const { context, server } = createAppServer();

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  return {
    context,
    host,
    server,
    port,
  };
}
