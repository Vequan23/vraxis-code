import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CodingRuntimeEngine, RuntimeReadiness } from "@vraxis/agent-v";
import type { RuntimeSummary } from "@vraxis/code-contracts";
import { RuntimeConformanceRegistry } from "../src/runtimes/runtime-conformance.js";

function runtime(id = "codex", version = "codex 1.0.0"): RuntimeSummary {
  return {
    id,
    name: id === "cursor" ? "Cursor Agent" : "Codex CLI",
    availability: "installed",
    detail: "Installed.",
    acceptsCustomModel: true,
    models: [],
    kind: "local-cli",
    version,
  };
}

function engine(readiness: RuntimeReadiness): Pick<CodingRuntimeEngine, "probe"> {
  return { async probe() { return readiness; } };
}

test("persists a version-bound live runtime conformance result", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-runtime-conformance-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const readiness: RuntimeReadiness = {
    runtimeId: "codex",
    availability: "installed",
    verification: "ready",
    version: "codex 1.0.0",
    checkedAt: "2026-08-31T12:00:00.000Z",
    durationMs: 420,
    detail: "Authenticated and returned schema-valid bounded output.",
  };
  const registry = new RuntimeConformanceRegistry(directory, engine(readiness));
  const before = (await registry.decorate([runtime()]))[0]!;
  assert.equal(before.conformance?.state, "unverified");
  assert.deepEqual(before.conformance?.checks.map((check) => check.state), ["passed", "passed", "not-checked"]);

  const result = await registry.probe(runtime(), "gpt-5");
  assert.equal(result.state, "ready");
  assert.equal(result.durationMs, 420);
  assert.deepEqual(result.checks.map((check) => check.state), ["passed", "passed", "passed"]);

  const reopened = new RuntimeConformanceRegistry(directory, engine({ ...readiness, verification: "failed" }));
  assert.equal((await reopened.decorate([runtime()]))[0]?.conformance?.state, "ready");
  const updated = (await reopened.decorate([runtime("codex", "codex 2.0.0")]))[0]?.conformance;
  assert.equal(updated?.state, "stale");
  assert.match(updated?.detail ?? "", /previous probe covered codex 1.0.0/);
});

test("keeps an unverified Cursor isolation contract limited on older releases", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-runtime-conformance-cursor-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const cursor = runtime("cursor", "2026.07.12");
  const readiness: RuntimeReadiness = {
    runtimeId: "cursor",
    availability: "installed",
    verification: "ready",
    version: cursor.version,
    checkedAt: "2026-08-31T12:00:00.000Z",
    detail: "Authenticated and returned schema-valid bounded output.",
  };
  const registry = new RuntimeConformanceRegistry(directory, engine(readiness));
  const result = await registry.probe(cursor);
  assert.equal(result.state, "limited");
  assert.equal(result.checks.find((check) => check.id === "host-tool-isolation")?.state, "failed");
  assert.equal(result.checks.find((check) => check.id === "live-output")?.state, "passed");
});
