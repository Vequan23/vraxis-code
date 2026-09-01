import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { listenLoopback } from "../src/http/listen-loopback.js";

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("waits for a restarting loopback service to release its port", async (context) => {
  const previous = createServer();
  await listenLoopback(previous, 0, { attempts: 0 });
  context.after(() => close(previous).catch(() => undefined));
  const address = previous.address();
  assert.ok(address && typeof address !== "string");

  const replacement = createServer();
  context.after(() => close(replacement).catch(() => undefined));
  setTimeout(() => void close(previous), 30);
  await listenLoopback(replacement, address.port, { attempts: 10, retryDelayMs: 10 });

  assert.equal(replacement.listening, true);
  assert.equal((replacement.address() as { port: number }).port, address.port);
});
