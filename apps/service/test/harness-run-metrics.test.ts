import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { HarnessRunMetricsV1 } from "@vraxis/code-contracts";
import { aggregateHarnessMetrics, exportHarnessMetrics } from "../src/metrics/harness-run-metrics-aggregation.js";
import { HarnessRunMetricsRegistry } from "../src/metrics/harness-run-metrics-registry.js";

function sampleRun(overrides: Partial<HarnessRunMetricsV1> = {}): HarnessRunMetricsV1 {
  const completedAt = new Date().toISOString();
  return {
    kind: "vraxis.harness-run-metrics",
    version: 1,
    id: crypto.randomUUID(),
    sessionId: "session-1",
    projectId: "project-1",
    runId: crypto.randomUUID(),
    runtimeId: "codex",
    runtimeVersion: "1.0.0",
    mode: "ask",
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    completedAt,
    durationMs: 60_000,
    outcome: "complete",
    tools: [{ id: "read-file", calls: 2, successes: 2, failures: 0, totalDurationMs: 400 }],
    approvals: { requested: 1, approved: 1, denied: 0, totalWaitMs: 1200 },
    compactions: 0,
    tokens: { total: 1200 },
    ...overrides,
  };
}

test("aggregates harness metrics by runtime and mode", () => {
  const summary = aggregateHarnessMetrics([
    sampleRun(),
    sampleRun({ runtimeId: "codex", mode: "plan", outcome: "failed", tools: [{ id: "read-file", calls: 1, successes: 0, failures: 1, totalDurationMs: 0 }] }),
    sampleRun({ runtimeId: "claude", mode: "ask", runtimeVersion: "2.0.0" }),
  ], { enabled: true, windowDays: 30 });

  assert.equal(summary.kind, "vraxis.harness-metrics-summary");
  assert.equal(summary.enabled, true);
  assert.equal(summary.totalRuns, 3);
  assert.equal(summary.byRuntime.length, 3);
  const codexAsk = summary.byRuntime.find((item) => item.runtimeId === "codex" && item.mode === "ask");
  assert.ok(codexAsk);
  assert.equal(codexAsk?.runs, 1);
  assert.equal(codexAsk?.completed, 1);
});

test("exports aggregated metrics without raw session content", () => {
  const summary = aggregateHarnessMetrics([sampleRun()], { enabled: true });
  const exported = exportHarnessMetrics(summary);
  const serialized = JSON.stringify(exported);
  assert.equal(exported.kind, "vraxis.harness-metrics-export");
  assert.equal(serialized.includes("session-1"), false);
  assert.equal(serialized.includes("project-1"), false);
  assert.equal(exported.aggregates.length, 1);
});

test("registry stores and clears harness run metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vraxis-harness-metrics-"));
  const registry = new HarnessRunMetricsRegistry(directory);
  await registry.record(sampleRun());
  assert.equal((await registry.list()).length, 1);
  const summary = await registry.summary(true);
  assert.equal(summary.totalRuns, 1);
  await registry.clear();
  assert.equal((await registry.list()).length, 0);
});
