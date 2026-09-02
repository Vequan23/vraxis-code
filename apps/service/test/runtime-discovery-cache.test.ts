import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeDiscoveryCache, bootstrapDiscoveryTimeoutMs } from "../src/runtimes/runtime-discovery-cache.js";

test("serves cached runtimes without rediscovering", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-runtime-cache-"));
  let discoveries = 0;
  const cache = new RuntimeDiscoveryCache(directory, async () => {
    discoveries += 1;
    return [{
      id: "cursor",
      name: "Cursor Agent",
      availability: "installed",
      detail: "Ready",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      authentication: "authenticated",
      authenticationDetail: "Ready",
      checkedAt: new Date().toISOString(),
      modelDiscovery: "automatic",
      update: { status: "unknown", detail: "Ready" },
      maintenanceActions: [],
    }];
  });
  await cache.start();
  const first = await cache.get();
  assert.equal(first[0]?.id, "cursor");
  assert.equal(discoveries, 1);
  const second = await cache.get();
  assert.equal(second[0]?.id, "cursor");
  assert.equal(discoveries, 1);
  await cache.refresh({ force: true, timeoutMs: bootstrapDiscoveryTimeoutMs });
  assert.equal(discoveries, 2);
  const persisted = JSON.parse(await readFile(join(directory, "runtime-discovery.json"), "utf8")) as { runtimes: Array<{ id: string }> };
  assert.equal(persisted.runtimes[0]?.id, "cursor");
  await rm(directory, { recursive: true, force: true });
});

test("uses the bootstrap timeout when the cache is empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-runtime-cache-"));
  let timeoutMs: number | undefined;
  const cache = new RuntimeDiscoveryCache(directory, async (options) => {
    timeoutMs = options?.timeoutMs;
    return [];
  });
  await cache.get();
  assert.equal(timeoutMs, bootstrapDiscoveryTimeoutMs);
  await rm(directory, { recursive: true, force: true });
});
