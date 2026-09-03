import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProviderConformanceRegistry } from "../src/model-providers/provider-conformance.js";

test("provider conformance records bounded probe results", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-provider-conformance-"));
  try {
    const registry = new ProviderConformanceRegistry(directory);
    const runtime = {
      id: "provider-test",
      name: "Test Provider",
      availability: "installed" as const,
      detail: "Ready",
      acceptsCustomModel: true,
      models: [],
      kind: "hosted-provider" as const,
    };
    assert.equal((await registry.decorate([runtime]))[0]?.conformance?.state, "unverified");
    const result = await registry.recordProbe(runtime.id, {
      runtimeId: runtime.id,
      availability: "installed",
      verification: "ready",
      checkedAt: new Date().toISOString(),
      durationMs: 12,
      detail: "Ready",
    }, true);
    assert.equal(result.state, "ready");
    assert.equal((await registry.decorate([runtime]))[0]?.conformance?.state, "ready");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
