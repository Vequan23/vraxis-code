import { describe, expect, it } from "vitest";
import type { HarnessMetricsRecommendationV1 } from "@vraxis/code-contracts";
import { selectPostRunNudgeRecommendation } from "./harness-recommendation-actions.js";

const preferRuntime: HarnessMetricsRecommendationV1 = {
  id: "prefer:ask:codex:claude-code",
  kind: "prefer-runtime",
  tone: "success",
  title: "Prefer claude-code for Ask mode",
  detail: "Claude scored better across recent runs.",
  confidence: "high",
  mode: "ask",
  runtimeId: "codex",
  suggestedRuntimeId: "claude-code",
  action: { type: "set-default-runtime", runtimeId: "claude-code" },
};

const verifyConformance: HarnessMetricsRecommendationV1 = {
  id: "conformance:codex",
  kind: "verify-conformance",
  tone: "warning",
  title: "Verify codex conformance",
  detail: "Last probe failed.",
  confidence: "high",
  runtimeId: "codex",
  action: { type: "probe-runtime", runtimeId: "codex" },
};

describe("selectPostRunNudgeRecommendation", () => {
  it("prefers the first actionable recommendation for the completed session", () => {
    const selected = selectPostRunNudgeRecommendation({
      recommendations: [verifyConformance, preferRuntime],
      sessionMode: "ask",
      sessionRuntimeId: "codex",
      dismissedIds: new Set(),
    });
    expect(selected?.id).toBe(verifyConformance.id);
  });

  it("skips recommendations duplicated by the composer routing hint", () => {
    const selected = selectPostRunNudgeRecommendation({
      recommendations: [preferRuntime, verifyConformance],
      sessionMode: "ask",
      sessionRuntimeId: "codex",
      dismissedIds: new Set(),
      routingHint: {
        id: "routing:codex:ask",
        suggestedRuntimeId: "claude-code",
        reason: preferRuntime.detail,
        confidence: "high",
      },
    });
    expect(selected?.id).toBe(verifyConformance.id);
  });

  it("ignores dismissed and non-actionable recommendations", () => {
    const selected = selectPostRunNudgeRecommendation({
      recommendations: [{
        id: "collect-more-data",
        kind: "collect-more-data",
        tone: "info",
        title: "Collect a few more runs",
        detail: "Need more data.",
        confidence: "low",
      }, verifyConformance],
      sessionMode: "ask",
      sessionRuntimeId: "codex",
      dismissedIds: new Set([verifyConformance.id]),
    });
    expect(selected).toBeNull();
  });
});
