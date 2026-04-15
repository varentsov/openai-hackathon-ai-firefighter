import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = [".env.local", ".env", ".env.example"] as const;

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    parsed[key] = stripWrappingQuotes(value);
  }

  return parsed;
}

export function loadEnvFiles(cwd = process.cwd()): string[] {
  const loadedFiles: string[] = [];

  for (const filename of ENV_FILES) {
    const absolutePath = resolve(cwd, filename);

    if (!existsSync(absolutePath)) {
      continue;
    }

    const parsed = parseEnvFile(readFileSync(absolutePath, "utf-8"));

    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    loadedFiles.push(filename);
  }

  return loadedFiles;
}
