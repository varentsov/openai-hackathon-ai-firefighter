import { loadEnvFiles } from "./config/loadEnv.js";
import { startServer } from "./server.js";

async function main(): Promise<void> {
  loadEnvFiles();
  const { host, port } = await startServer();

  console.log(`CorePath incident console listening on http://${host}:${port}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
