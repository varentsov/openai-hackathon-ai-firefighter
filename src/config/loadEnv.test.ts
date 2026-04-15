import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvFiles } from "./loadEnv.js";

test("loadEnvFiles loads quoted values from .env.example without overwriting existing process env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "env-loader-"));
  const originalPort = process.env.PORT;
  const originalOpenAi = process.env.OPENAI_API_KEY;

  writeFileSync(
    join(tempDir, ".env.example"),
    [
      'OPENAI_API_KEY="test-openai-key"',
      "PORT=4567",
      'LANGFUSE_BASE_URL="https://cloud.langfuse.com"',
    ].join("\n"),
  );

  process.env.PORT = "9999";
  delete process.env.OPENAI_API_KEY;
  delete process.env.LANGFUSE_BASE_URL;

  const loadedFiles = loadEnvFiles(tempDir);

  assert.deepEqual(loadedFiles, [".env.example"]);
  assert.equal(process.env.OPENAI_API_KEY, "test-openai-key");
  assert.equal(process.env.PORT, "9999");
  assert.equal(process.env.LANGFUSE_BASE_URL, "https://cloud.langfuse.com");

  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }

  if (originalOpenAi === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAi;
  }

  delete process.env.LANGFUSE_BASE_URL;
});
