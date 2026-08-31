import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ServiceLifecycleMarker } from "../src/diagnostics/service-lifecycle.js";

test("distinguishes an unexpected exit from a clean service shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-service-lifecycle-"));
  const firstProcess = new ServiceLifecycleMarker(root);
  assert.equal((await firstProcess.begin()).previousUnexpectedExit, false);

  const processAfterCrash = new ServiceLifecycleMarker(root);
  const recovered = await processAfterCrash.begin();
  assert.equal(recovered.previousUnexpectedExit, true);
  assert.ok(recovered.previousStartedAt);
  await processAfterCrash.finish();

  const processAfterCleanShutdown = new ServiceLifecycleMarker(root);
  assert.equal((await processAfterCleanShutdown.begin()).previousUnexpectedExit, false);
  await processAfterCleanShutdown.finish();
});
