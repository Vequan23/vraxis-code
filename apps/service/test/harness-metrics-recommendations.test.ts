import assert from "node:assert/strict";
import test from "node:test";
import type { HarnessRunMetricsV1, HarnessMetricsSummaryV1, UserSettings } from "@vraxis/code-contracts";
import { aggregateHarnessMetrics } from "../src/metrics/harness-run-metrics-aggregation.js";
import {
  autoApplyHarnessRecommendation,
  deriveHarnessRecommendations,
  deriveHarnessRoutingHint,
} from "../src/metrics/harness-metrics-recommendations.js";

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
    approvals: { requested: 0, approved: 0, denied: 0, totalWaitMs: 0 },
    compactions: 0,
    tokens: { total: 1200 },
    verification: { runs: 1, passed: 1 },
    ...overrides,
  };
}

function strugglingCodexRuns(count: number): HarnessRunMetricsV1[] {
  return Array.from({ length: count }, () => sampleRun({
    runtimeId: "codex",
    outcome: "failed",
    tools: [{ id: "read-file", calls: 4, successes: 1, failures: 3, totalDurationMs: 400 }],
    verification: { runs: 1, passed: 0 },
  }));
}

function reliableClaudeRuns(count: number): HarnessRunMetricsV1[] {
  return Array.from({ length: count }, () => sampleRun({
    runtimeId: "claude-code",
    outcome: "complete",
    tools: [{ id: "read-file", calls: 4, successes: 4, failures: 0, totalDurationMs: 200 }],
    verification: { runs: 1, passed: 1 },
  }));
}

test("derives collect-more-data guidance before enough runs exist", () => {
  const summary = aggregateHarnessMetrics([sampleRun(), sampleRun()], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  assert.ok(recommendations.some((item) => item.kind === "collect-more-data"));
});

test("prefers a stronger runtime after enough comparable runs", () => {
  const summary = aggregateHarnessMetrics([
    ...strugglingCodexRuns(4),
    ...reliableClaudeRuns(4),
  ], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  const prefer = recommendations.find((item) => item.kind === "prefer-runtime");
  assert.ok(prefer);
  assert.equal(prefer?.suggestedRuntimeId, "claude-code");
  assert.equal(prefer?.action?.type, "set-default-runtime");
});

test("auto-applies high-confidence prefer-runtime recommendations", () => {
  const summary = aggregateHarnessMetrics([
    ...strugglingCodexRuns(4),
    ...reliableClaudeRuns(4),
  ], { enabled: true });
  summary.recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  const settings: UserSettings = {
    theme: "graphite",
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    harnessMetricsAutoApply: true,
  };
  const patch = autoApplyHarnessRecommendation(summary, settings, ["codex", "claude-code"]);
  assert.deepEqual(patch, { defaultRuntimeId: "claude-code" });
});

test("does not auto-apply when disabled or already on the suggested runtime", () => {
  const summary = aggregateHarnessMetrics([
    ...strugglingCodexRuns(4),
    ...reliableClaudeRuns(4),
  ], { enabled: true }) as HarnessMetricsSummaryV1;
  summary.recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  const disabled: UserSettings = {
    theme: "graphite",
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    harnessMetricsAutoApply: false,
  };
  assert.equal(autoApplyHarnessRecommendation(summary, disabled, ["codex", "claude-code"]), null);

  const alreadyApplied: UserSettings = {
    theme: "graphite",
    defaultMode: "ask",
    defaultRuntimeId: "claude-code",
    harnessMetricsAutoApply: true,
  };
  assert.equal(autoApplyHarnessRecommendation(summary, alreadyApplied, ["codex", "claude-code"]), null);
});

test("suggests verify-conformance when default runtime is stale", () => {
  const summary = aggregateHarnessMetrics([...reliableClaudeRuns(4)], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "claude-code",
    installedRuntimeIds: ["claude-code"],
    runtimeConformance: { "claude-code": "stale" },
  });
  const verify = recommendations.find((item) => item.kind === "verify-conformance");
  assert.ok(verify);
  assert.equal(verify?.action?.type, "probe-runtime");
});

test("flags high compaction and token usage on a runtime/mode pair", () => {
  const summary = aggregateHarnessMetrics([
    ...Array.from({ length: 4 }, () => sampleRun({
      runtimeId: "codex",
      compactions: 2,
      tokens: { total: 60_000 },
    })),
  ], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex"],
  });
  assert.ok(recommendations.some((item) => item.kind === "high-compaction"));
  assert.ok(recommendations.some((item) => item.kind === "high-tokens"));
});

test("prefers a stronger mode on the default runtime", () => {
  const summary = aggregateHarnessMetrics([
    ...Array.from({ length: 4 }, () => sampleRun({
      runtimeId: "codex",
      mode: "ask",
      outcome: "failed",
      tools: [{ id: "read-file", calls: 4, successes: 1, failures: 3, totalDurationMs: 400 }],
      verification: { runs: 1, passed: 0 },
    })),
    ...Array.from({ length: 4 }, () => sampleRun({
      runtimeId: "codex",
      mode: "plan",
      outcome: "complete",
      tools: [{ id: "read-file", calls: 4, successes: 4, failures: 0, totalDurationMs: 200 }],
      verification: { runs: 1, passed: 1 },
    })),
  ], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex"],
  });
  const preferMode = recommendations.find((item) => item.kind === "prefer-mode");
  assert.ok(preferMode);
  assert.equal(preferMode?.action?.type, "set-default-mode");
  assert.equal(preferMode?.action?.type === "set-default-mode" ? preferMode.action.mode : undefined, "plan");
});

test("derives composer routing hint from prefer-runtime and prefer-mode", () => {
  const summary = aggregateHarnessMetrics([
    ...strugglingCodexRuns(4),
    ...reliableClaudeRuns(4),
    ...Array.from({ length: 4 }, () => sampleRun({
      runtimeId: "codex",
      mode: "plan",
      outcome: "complete",
      tools: [{ id: "read-file", calls: 4, successes: 4, failures: 0, totalDurationMs: 200 }],
      verification: { runs: 1, passed: 1 },
    })),
  ], { enabled: true });
  const recommendations = deriveHarnessRecommendations(summary, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  const hint = deriveHarnessRoutingHint(recommendations, {
    defaultMode: "ask",
    defaultRuntimeId: "codex",
    installedRuntimeIds: ["codex", "claude-code"],
  });
  assert.ok(hint);
  assert.equal(hint?.suggestedRuntimeId, "claude-code");
  assert.equal(hint?.suggestedMode, "plan");
});
