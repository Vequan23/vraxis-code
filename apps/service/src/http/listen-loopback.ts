import type { Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export interface LoopbackListenOptions {
  attempts?: number;
  retryDelayMs?: number;
}

function listenOnce(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

export async function listenLoopback(
  server: Server,
  port: number,
  options: LoopbackListenOptions = {},
): Promise<void> {
  const attempts = options.attempts ?? 40;
  const retryDelayMs = options.retryDelayMs ?? 100;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await listenOnce(server, port);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= attempts) throw error;
      await delay(retryDelayMs);
    }
  }
}
