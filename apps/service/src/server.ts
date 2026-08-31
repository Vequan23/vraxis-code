import { createServer } from "node:http";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./http/app.js";
import { ServiceLifecycleMarker } from "./diagnostics/service-lifecycle.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
const dataDirectory = process.env.VRAXIS_CODE_DATA_DIR ?? join(homedir(), ".vraxis", "code", "database");
const publicDirectory = process.env.VRAXIS_CODE_PUBLIC_DIR ?? join(moduleDirectory, "public");
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
if (process.platform !== "win32") await chmod(dataDirectory, 0o700);
const lifecycle = new ServiceLifecycleMarker(dataDirectory);
const startupRecovery = await lifecycle.begin();

const app = createApp({
  dataDirectory,
  publicDirectory,
  startupRecovery,
  ...(process.env.VRAXIS_DESKTOP_TOKEN ? { desktopToken: process.env.VRAXIS_DESKTOP_TOKEN } : {}),
});
const server = createServer(app);

server.listen(port, "127.0.0.1", () => {
  console.log(`Vraxis Code service listening on http://127.0.0.1:${port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => undefined);
  await app.close().catch(() => undefined);
  await lifecycle.finish().catch(() => undefined);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown());
}
