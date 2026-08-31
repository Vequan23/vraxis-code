import {
  LocalCliRuntimeDiscovery,
  builtInRuntimes,
  parseLocalRuntimeModelCatalog,
  type LocalRuntimeInventoryItem,
} from "@vraxis/agent-v/local-cli";
import type { ModelCapability, RuntimeModelSummary, RuntimeSummary } from "@vraxis/code-contracts";

export interface RuntimeDiscoveryOptions {
  timeoutMs?: number;
  cwd?: string;
  discovery?: Pick<LocalCliRuntimeDiscovery, "list">;
}

const modelCapabilities = new Set<ModelCapability>(["text", "vision", "audio", "video", "tools", "structured-output", "reasoning"]);

function modelSummary(model: LocalRuntimeInventoryItem["models"][number]): RuntimeModelSummary {
  const capabilities = model.capabilities?.filter((capability): capability is ModelCapability => modelCapabilities.has(capability as ModelCapability));
  return {
    id: model.id,
    name: model.name,
    availability: model.availability,
    ...(model.description ? { description: model.description } : {}),
    ...(model.isDefault ? { isDefault: true } : {}),
    ...(capabilities?.length ? { capabilities: [...capabilities] } : {}),
    ...(model.reasoningEfforts?.length ? { reasoningEfforts: [...model.reasoningEfforts] } : {}),
  };
}

function runtimeSummary(item: LocalRuntimeInventoryItem): RuntimeSummary {
  const definition = builtInRuntimes.find((runtime) => runtime.id === item.id);
  const versionIsolationVerified = Boolean(
    !definition?.supportsHostToolIsolation
    || (item.readiness.version && definition.supportsHostToolIsolation(item.readiness.version)),
  );
  const governedBuild = Boolean(
    (definition?.configureMcp || definition?.hostToolTransport === "acp")
    && definition.capabilities.includes("mcp-tools")
    && definition.capabilities.includes("read-only-workspace")
    && definition.capabilities.includes("workspace-write")
    && versionIsolationVerified,
  );
  const capabilities = definition?.capabilities.filter((capability) => capability !== "workspace-write" || governedBuild);
  return {
    id: item.id,
    name: item.name,
    availability: item.readiness.availability,
    detail: definition?.capabilities.includes("workspace-write") && !governedBuild
      ? `${item.readiness.detail} Guarded Build is unavailable until this harness version can accept ephemeral Vraxis tools with native execution disabled.`
      : item.readiness.detail,
    acceptsCustomModel: true,
    models: item.models.map(modelSummary),
    kind: "local-cli",
    ...(item.readiness.version ? { version: item.readiness.version } : {}),
    ...(item.command ? { executable: [item.command.command, ...item.command.argsPrefix].join(" ") } : {}),
    ...(item.application ? { applicationPath: item.application.path } : {}),
    authentication: item.authentication,
    authenticationDetail: item.authenticationDetail,
    checkedAt: item.checkedAt,
    modelDiscovery: item.modelDiscovery,
    update: { ...item.update },
    maintenanceActions: item.maintenanceActions.map((action) => ({
      id: action.id,
      label: action.label,
      detail: action.detail,
      kind: action.kind,
      ...(action.executable ? { executable: action.executable } : {}),
      ...(action.args ? { arguments: [...action.args] } : {}),
      ...(action.url ? { url: action.url } : {}),
      requiresNetwork: action.requiresNetwork,
    })),
    ...(capabilities ? { capabilities: [...capabilities] } : {}),
  };
}

/** Backward-compatible parser export; parsing is owned and tested by agent-v. */
export const parseLineModelCatalog = parseLocalRuntimeModelCatalog;

export async function discoverRuntimes(options: RuntimeDiscoveryOptions = {}): Promise<RuntimeSummary[]> {
  const discovery = options.discovery ?? new LocalCliRuntimeDiscovery({
    cwd: options.cwd ?? process.cwd(),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  return (await discovery.list()).map(runtimeSummary);
}
