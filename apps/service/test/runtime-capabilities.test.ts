import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeSummary } from "@vraxis/code-contracts";
import { withProductCapabilities } from "../src/runtimes/runtime-capabilities.js";

function runtime(overrides: Partial<RuntimeSummary> = {}): RuntimeSummary {
  return {
    id: "codex",
    name: "Codex CLI",
    availability: "installed",
    detail: "Ready",
    acceptsCustomModel: true,
    models: [],
    kind: "local-cli",
    modelDiscovery: "automatic",
    capabilities: ["read-only-workspace", "workspace-write", "mcp-tools"],
    ...overrides,
  };
}

test("publishes the enforced product surface for a governed local harness", () => {
  const result = withProductCapabilities(runtime());
  assert.equal(result.productCapabilities?.length, 9);
  assert.ok(result.productCapabilities?.every((item) => item.state === "available"));
});

test("explains unavailable writes and tools instead of advertising inert controls", () => {
  const result = withProductCapabilities(runtime({
    id: "cursor",
    name: "Cursor Agent",
    capabilities: ["read-only-workspace", "workspace-write"],
    modelDiscovery: "manual",
  }));
  const byId = new Map(result.productCapabilities?.map((item) => [item.id, item]));
  assert.equal(byId.get("repository-read")?.state, "available");
  assert.equal(byId.get("isolated-build")?.state, "unavailable");
  assert.equal(byId.get("governed-terminal")?.state, "unavailable");
  assert.equal(byId.get("controlled-browser")?.state, "unavailable");
  assert.equal(byId.get("task-evidence")?.state, "unavailable");
  assert.equal(byId.get("model-catalog")?.state, "limited");
  assert.match(byId.get("isolated-build")?.detail ?? "", /cannot be enforced/);
});

test("advertises hosted Build only when provider tools enforce its writes", () => {
  const limited = withProductCapabilities(runtime({
    id: "hosted-without-tools",
    name: "Hosted without tools",
    kind: "hosted-provider",
    capabilities: ["read-only-workspace", "workspace-write"],
  }));
  const governed = withProductCapabilities(runtime({
    id: "hosted-governed",
    name: "Hosted governed",
    kind: "hosted-provider",
    capabilities: ["read-only-workspace", "workspace-write", "tools", "browser-control"],
  }));
  const limitedById = new Map(limited.productCapabilities?.map((item) => [item.id, item]));
  const governedById = new Map(governed.productCapabilities?.map((item) => [item.id, item]));
  assert.equal(limitedById.get("isolated-build")?.state, "unavailable");
  assert.equal(limitedById.get("governed-terminal")?.state, "unavailable");
  assert.equal(governedById.get("isolated-build")?.state, "available");
  assert.equal(governedById.get("governed-terminal")?.state, "available");
  assert.equal(governedById.get("controlled-browser")?.state, "available");
});

test("marks every capability unavailable while harness setup is incomplete", () => {
  const result = withProductCapabilities(runtime({ availability: "setup-required" }));
  assert.ok(result.productCapabilities?.every((item) => item.state === "unavailable"));
  assert.match(result.productCapabilities?.[0]?.detail ?? "", /setup/);
});
