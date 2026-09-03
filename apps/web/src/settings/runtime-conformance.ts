import type { RuntimeSummary } from "@vraxis/code-contracts";

export function runtimeConformanceLabel(runtime: RuntimeSummary | undefined): string {
  if (runtime?.conformance?.state === "ready") return "Verified";
  if (runtime?.conformance?.state === "failed") return "Probe failed";
  if (runtime?.conformance?.state === "limited") return "Limited";
  if (runtime?.conformance?.state === "stale") return "Stale";
  return runtime?.kind === "hosted-provider" ? "Untested" : "Unverified";
}

export function runtimeConformanceTone(runtime: RuntimeSummary | undefined): "success" | "warning" | "neutral" | "error" {
  if (runtime?.conformance?.state === "ready") return "success";
  if (runtime?.conformance?.state === "failed") return "error";
  if (runtime?.conformance?.state === "limited" || runtime?.conformance?.state === "stale") return "warning";
  return "neutral";
}

export function runtimeIsReady(runtime: RuntimeSummary | undefined): boolean {
  if (!runtime || runtime.availability !== "installed" || runtime.authentication === "required") return false;
  return runtime.conformance?.state === "ready";
}

export function runtimeCanProbe(runtime: RuntimeSummary | undefined): boolean {
  return Boolean(
    runtime
    && runtime.availability === "installed"
    && runtime.authentication !== "required"
    && runtime.conformance?.state !== "ready",
  );
}

export function runtimePickerSubtitle(runtime: RuntimeSummary, isEnabled: boolean): string {
  if (runtime.availability !== "installed") return runtime.applicationPath ? "CLI needed" : "Setup needed";
  if (!isEnabled) return "Disabled in settings";
  if (runtime.authentication === "required") return "Sign in needed";
  const state = runtime.conformance?.state;
  if (state === "ready") return runtime.kind === "hosted-provider" ? "Verified" : "Ready";
  if (state === "failed") return "Probe failed";
  if (state === "stale") return "Stale — re-verify";
  if (state === "limited") return "Limited capability";
  return runtime.kind === "hosted-provider" ? "Untested — verify first" : "Unverified";
}

export function runtimeSubmitBlockMessage(runtime: RuntimeSummary | undefined): string | undefined {
  if (!runtime || runtime.availability !== "installed" || runtime.authentication === "required") return undefined;
  if (runtime.conformance?.state === "ready") return undefined;
  if (runtime.conformance?.state === "failed") {
    return `${runtime.name} failed its connection test. Open Settings → Runtimes and fix the connection before starting a task.`;
  }
  if (runtime.kind === "hosted-provider") {
    return `${runtime.name} is connected but not verified. Run Test connection in Settings → Runtimes before starting a task.`;
  }
  return `${runtime.name} is not verified. Run a live conformance check in Settings → Runtimes before starting a task.`;
}
