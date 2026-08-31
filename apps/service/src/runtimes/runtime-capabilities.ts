import type { RuntimeProductCapabilitySummary, RuntimeSummary } from "@vraxis/code-contracts";

function capability(
  id: RuntimeProductCapabilitySummary["id"],
  label: string,
  state: RuntimeProductCapabilitySummary["state"],
  detail: string,
): RuntimeProductCapabilitySummary {
  return { id, label, state, detail };
}

export function withProductCapabilities(runtime: RuntimeSummary): RuntimeSummary {
  const declared = new Set(runtime.capabilities ?? []);
  const installed = runtime.availability === "installed";
  const repositoryRead = installed && declared.has("read-only-workspace");
  const governedTools = installed && (
    (runtime.kind === "hosted-provider" && declared.has("tools"))
    || (repositoryRead && declared.has("mcp-tools"))
  );
  const isolatedBuild = governedTools && declared.has("workspace-write");
  const browserControl = governedTools && (runtime.kind !== "hosted-provider" || declared.has("browser-control"));
  const modelCatalog = runtime.modelDiscovery === "automatic" || runtime.modelDiscovery === "aliases"
    ? "available"
    : runtime.acceptsCustomModel ? "limited" : "unavailable";
  const unavailableDetail = runtime.availability === "missing"
    ? "Install this harness to use it."
    : runtime.availability === "setup-required"
      ? "Finish authentication or setup before using this capability."
      : "This harness cannot enforce the required boundary.";

  const productCapabilities: RuntimeProductCapabilitySummary[] = [
    capability("repository-read", "Repository read", repositoryRead ? "available" : "unavailable", repositoryRead
      ? "Vraxis can enforce read-only project access for Ask, Plan, and Review."
      : unavailableDetail),
    capability("isolated-build", "Isolated Build", isolatedBuild ? "available" : "unavailable", isolatedBuild
      ? "Writes are restricted to the task worktree and Vraxis-owned tools."
      : installed ? "Build stays unavailable because guarded workspace writes cannot be enforced." : unavailableDetail),
    capability("governed-terminal", "Governed terminal", governedTools ? "available" : "unavailable", governedTools
      ? "Agent commands use Vraxis approvals and retained PTY receipts."
      : installed ? "This harness cannot receive the private per-run Vraxis tool bridge safely." : unavailableDetail),
    capability("controlled-browser", "Controlled browser", browserControl ? "available" : "unavailable", browserControl
      ? "The agent can inspect and actuate the isolated task browser through approvals."
      : installed ? "Browser context may be visible, but governed browser actuation is unavailable." : unavailableDetail),
    capability("task-evidence", "Task evidence", governedTools ? "available" : "unavailable", governedTools
      ? "The harness can inspect a secret-safe index of retained approvals, terminal runs, browser actions, and verification status."
      : installed ? "This harness cannot receive the task-scoped Vraxis evidence tool safely." : unavailableDetail),
    capability("skills", "Attached skills", installed ? "available" : "unavailable", installed
      ? "Task skills are injected as guidance and cannot grant extra authority."
      : unavailableDetail),
    capability("model-catalog", "Model selection", installed ? modelCatalog : "unavailable", !installed
      ? unavailableDetail
      : modelCatalog === "available"
        ? "Models and updates are discovered from the harness."
        : modelCatalog === "limited"
          ? "Enter a model ID manually; this harness does not publish a complete catalog."
          : "This harness does not expose model selection."),
    capability("retained-verification", "Retained verification", installed ? "available" : "unavailable", installed
      ? "The agent can request a handoff, but only the user can start the exact project-owned recipe through Vraxis approvals."
      : unavailableDetail),
  ];
  return { ...runtime, productCapabilities };
}

export function withProductCapabilityMatrix(runtimes: RuntimeSummary[]): RuntimeSummary[] {
  return runtimes.map(withProductCapabilities);
}
