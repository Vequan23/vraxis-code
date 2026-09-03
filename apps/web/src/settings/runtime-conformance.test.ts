import { expect, it } from "vitest";
import type { RuntimeSummary } from "@vraxis/code-contracts";
import {
  runtimeCanProbe,
  runtimeIsReady,
  runtimePickerSubtitle,
  runtimeSubmitBlockMessage,
} from "./runtime-conformance.js";

const runtime = (overrides: Partial<RuntimeSummary> = {}): RuntimeSummary => ({
  id: "codex",
  name: "Codex",
  kind: "local-cli",
  availability: "installed",
  authentication: "authenticated",
  acceptsCustomModel: true,
  models: [],
  detail: "Ready",
  ...overrides,
});

it("requires verified conformance before a runtime is ready", () => {
  expect(runtimeIsReady(runtime({ conformance: { state: "ready", detail: "Verified", checks: [] } }))).toBe(true);
  expect(runtimeIsReady(runtime({ conformance: { state: "unverified", detail: "Not checked", checks: [] } }))).toBe(false);
  expect(runtimeIsReady(runtime({
    kind: "hosted-provider",
    conformance: { state: "ready", detail: "Verified", checks: [] },
  }))).toBe(true);
  expect(runtimeIsReady(runtime({ kind: "hosted-provider", conformance: undefined }))).toBe(false);
});

it("allows probing installed runtimes that are not verified", () => {
  expect(runtimeCanProbe(runtime({ conformance: { state: "unverified", detail: "Not checked", checks: [] } }))).toBe(true);
  expect(runtimeCanProbe(runtime({
    kind: "hosted-provider",
    conformance: { state: "unverified", detail: "Not checked", checks: [] },
  }))).toBe(true);
  expect(runtimeCanProbe(runtime({ conformance: { state: "ready", detail: "Verified", checks: [] } }))).toBe(false);
});

it("blocks task submit until hosted providers pass a connection test", () => {
  expect(runtimeSubmitBlockMessage(runtime({ conformance: { state: "ready", detail: "Verified", checks: [] } }))).toBeUndefined();
  expect(runtimeSubmitBlockMessage(runtime({
    kind: "hosted-provider",
    name: "Google Gemini",
    conformance: { state: "unverified", detail: "Not checked", checks: [] },
  }))).toMatch(/not verified/i);
  expect(runtimeSubmitBlockMessage(runtime({
    kind: "hosted-provider",
    name: "Google Gemini",
    conformance: { state: "failed", detail: "Probe failed", checks: [] },
  }))).toMatch(/failed its connection test/i);
});

it("describes hosted provider verification state in the runtime picker", () => {
  expect(runtimePickerSubtitle(runtime({
    kind: "hosted-provider",
    conformance: { state: "ready", detail: "Verified", checks: [] },
  }), true)).toBe("Verified");
  expect(runtimePickerSubtitle(runtime({
    kind: "hosted-provider",
    conformance: { state: "unverified", detail: "Not checked", checks: [] },
  }), true)).toMatch(/Untested/i);
});
