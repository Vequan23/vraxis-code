import {
  AgentVError,
  localExecutionScope,
  type CodingRuntimeEngine,
  type CodingRuntimeRequest,
  type CodingRuntimeResult,
  type CredentialStore,
  type EngineDescriptor,
  type EventSink,
  type RuntimeReadiness,
  type AgentTool,
} from "@vraxis/agent-v";
import { LocalCliRuntimeEngine, builtInRuntimes } from "@vraxis/agent-v/local-cli";
import { type ModelProviderId } from "@vraxis/agent-v/providers";
import { createAgentRuntime } from "@vraxis/agent-v/runtime";
import { createBrowserTools } from "@vraxis/agent-v/tools";
import { createFilesystemTools, createWorkspaceTools } from "@vraxis/agent-v/tools/node";
import type { ModelProviderRegistry } from "../model-providers/model-provider-registry.js";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";
import type { BrowserWorkspace } from "../browser/browser-workspace.js";
import { createAgentTerminalTool } from "../terminal/agent-terminal-tool.js";
import type { TerminalRegistry } from "../terminal/terminal-registry.js";
import { createAgentEvidenceTool } from "../sessions/agent-evidence-tool.js";
import { createAgentVerificationHandoffTool } from "../sessions/agent-verification-handoff-tool.js";
import type { VerificationRegistry } from "../verification/verification-registry.js";

const developmentCommands = ["bun", "cargo", "git", "go", "node", "npm", "npx", "pnpm", "python3", "pytest", "rg", "yarn"] as const;

export class VraxisCodeRuntimeEngine implements CodingRuntimeEngine {
  readonly descriptor: EngineDescriptor = {
    id: "vraxis-code-runtimes",
    name: "Vraxis Code runtimes",
    kind: "coding-runtime",
    capabilities: ["structured-output", "local-workspace", "read-only-workspace", "tools", "streaming", "artifacts"],
  };

  constructor(
    private readonly providers: ModelProviderRegistry,
    private readonly credentials: CredentialStore,
    private readonly approvals?: ApprovalRegistry,
    private readonly browser?: BrowserWorkspace,
    private readonly terminal?: TerminalRegistry,
    private readonly verifications?: VerificationRegistry,
    private readonly local = new LocalCliRuntimeEngine(),
  ) {}

  async inspect(runtimeId: string): Promise<RuntimeReadiness> {
    const profile = await this.providers.profile(runtimeId);
    if (!profile) return this.local.inspect(runtimeId);
    return { runtimeId, availability: "installed", verification: "ready", detail: `${profile.name} is connected.` };
  }

  async probe(runtimeId: string, runtimeModel?: string): Promise<RuntimeReadiness> {
    const profile = await this.providers.profile(runtimeId);
    if (!profile) return this.local.probe(runtimeId, runtimeModel);
    await this.providers.refresh(runtimeId);
    return { runtimeId, availability: "installed", verification: "ready", detail: `${profile.name} credentials and model catalog are ready.` };
  }

  async run<T>(request: CodingRuntimeRequest<T>, events?: EventSink): Promise<CodingRuntimeResult<T>> {
    const profile = await this.providers.profile(request.runtimeId);
    if (!request.workspacePath) throw new AgentVError("unsupported-capability", "Vraxis Code tasks require an approved workspace.");
    const sessionId = request.sessionId;
    const mode = typeof request.metadata?.mode === "string" ? request.metadata.mode : "ask";
    const productTools = await this.productTools(request, mode);
    const approvalPolicy = sessionId && this.approvals ? this.approvals.policy(sessionId, request.scope.projectId) : request.approvalPolicy;
    if (!profile) {
      const definition = builtInRuntimes.find((runtime) => runtime.id === request.runtimeId);
      const readiness = await this.local.inspect(request.runtimeId);
      const versionIsolationVerified = Boolean(
        !definition?.supportsHostToolIsolation
        || (readiness.version && definition.supportsHostToolIsolation(readiness.version)),
      );
      const governedToolsSupported = Boolean(
        (definition?.configureMcp || definition?.hostToolTransport === "acp")
        && definition.capabilities.includes("mcp-tools")
        && definition.capabilities.includes("read-only-workspace")
        && versionIsolationVerified,
      );
      if (request.workspaceAccess === "workspace-write" && !governedToolsSupported) {
        throw new AgentVError("unsupported-capability", `${definition?.name ?? request.runtimeId} cannot run Build until it supports ephemeral Vraxis tools with native execution disabled.`);
      }
      if (!governedToolsSupported) return this.local.run(request, events);
      const workspaceTools = request.workspaceAccess === "workspace-write"
        ? await createWorkspaceTools({ rootPath: request.workspacePath, allowedCommands: developmentCommands })
        : await createFilesystemTools({ rootPath: request.workspacePath });
      const governedWorkspaceTools = workspaceTools.filter((tool) => tool.name !== "run-command" && (mode === "build" || tool.sideEffect === "none"));
      return this.local.run({
        ...request,
        tools: [...(request.tools ?? []), ...governedWorkspaceTools, ...productTools],
        ...(approvalPolicy ? { approvalPolicy } : {}),
      }, events);
    }
    const selectedModel = request.runtimeModel ?? profile.model;
    if (!selectedModel) throw new AgentVError("configuration-invalid", "Choose a model before starting this task.");
    const workspaceTools = request.workspaceAccess === "workspace-write"
      ? await createWorkspaceTools({ rootPath: request.workspacePath, allowedCommands: developmentCommands })
      : await createFilesystemTools({ rootPath: request.workspacePath });
    const fileTools = request.workspaceAccess === "workspace-write"
      ? workspaceTools
      : workspaceTools.filter((tool) => tool.sideEffect === "none" && tool.risk === "read");
    const tools = [
      ...fileTools.filter((tool) => tool.name !== "run-command"),
      ...productTools,
    ];
    const runtime = createAgentRuntime({
      execution: {
        type: "provider",
        profile: {
          id: profile.id,
          name: profile.name,
          provider: profile.options?.provider as ModelProviderId,
          model: selectedModel,
          ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
          ...(typeof profile.options?.baseURL === "string" ? { baseURL: profile.options.baseURL } : {}),
        },
        credentials: this.credentials,
      },
      agent: {
        id: request.workspaceAccess === "workspace-write" ? "vraxis-code-builder" : "vraxis-code-reader",
        name: "Vraxis Code",
        instructions: request.workspaceAccess === "workspace-write"
          ? "Work only inside the approved isolated worktree. Request approval for guarded writes, commands, network, or browser actions and verify the result."
          : "Inspect only the approved repository and browser evidence. Use read tools for evidence and never claim files you did not inspect.",
        tools: tools.map((tool) => tool.name),
        requiredCapabilities: ["tools", "streaming"],
        maxSteps: 24,
      },
      tools,
      ...(events ? { events } : {}),
    });
    const scope = {
      ...localExecutionScope(request.scope.projectId, request.scope.principalId),
      permissions: [...new Set([...request.scope.permissions, "filesystem:read"])],
    };
    const result = await runtime.run({
      ...(request.runId ? { runId: request.runId } : {}),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      scope,
      input: request.input,
      output: request.output,
      model: selectedModel,
      ...(approvalPolicy ? { approvalPolicy } : {}),
    });
    return {
      runId: result.runId,
      output: result.output,
      provenance: result.provenance,
      durationMs: result.durationMs,
      ...(result.usage ? { usage: result.usage } : {}),
      runtimeId: request.runtimeId,
      activityCount: result.toolAudit.calls.length,
      attempts: 1,
    };
  }

  private async productTools(request: CodingRuntimeRequest<unknown>, mode: string): Promise<AgentTool[]> {
    const sessionId = request.sessionId;
    if (!sessionId) return [];
    const allowedOrigins = this.browser ? await this.browser.allowedOrigins(sessionId) : [];
    const browserTools = this.browser && (allowedOrigins.length || mode === "build")
      ? createBrowserTools({ controller: this.browser.controller(sessionId), allowedOrigins, allowNavigationRequests: mode === "build" })
      : [];
    const tools: AgentTool[] = browserTools.filter((tool) => mode === "build" || tool.sideEffect === "none");
    if (this.approvals && this.terminal && this.verifications) {
      tools.push(createAgentEvidenceTool({
        sessionId,
        approvals: this.approvals,
        terminal: this.terminal,
        verifications: this.verifications,
        ...(this.browser ? { browser: this.browser } : {}),
      }));
      tools.push(createAgentVerificationHandoffTool({
        sessionId,
        runtimeId: request.runtimeId,
        ...(request.runtimeModel ? { modelId: request.runtimeModel } : {}),
        verifications: this.verifications,
      }));
    }
    if (mode === "build" && request.workspacePath && this.terminal && this.approvals) {
      tools.push(createAgentTerminalTool({
        sessionId,
        workspacePath: request.workspacePath,
        terminal: this.terminal,
        approvals: this.approvals,
      }));
    }
    return tools;
  }
}
