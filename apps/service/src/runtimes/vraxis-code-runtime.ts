import {
  AgentVError,
  localExecutionScope,
  manageAgentContext,
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
import { createBrowserTools, type BrowserController } from "@vraxis/agent-v/tools";
import { createFilesystemTools, createWorkspaceTools } from "@vraxis/agent-v/tools/node";
import type { ModelProviderRegistry } from "../model-providers/model-provider-registry.js";
import type { ApprovalRegistry } from "../approvals/approval-registry.js";
import type { BrowserWorkspace } from "../browser/browser-workspace.js";
import { createAgentTerminalPollTool, createAgentTerminalStopTool, createAgentTerminalTool } from "../terminal/agent-terminal-tool.js";
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
      if (!governedToolsSupported) return this.runLocal(request, request.tools ?? [], events);
      const workspaceTools = request.workspaceAccess === "workspace-write"
        ? await createWorkspaceTools({
          rootPath: request.workspacePath,
          allowedCommands: developmentCommands,
          rejectPotentialSecrets: true,
          postEditChecks: [{
            name: "Git whitespace validation",
            command: "git",
            args: ["diff", "--check", "--no-ext-diff"],
            blocking: true,
          }],
        })
        : await createFilesystemTools({ rootPath: request.workspacePath });
      const governedWorkspaceTools = workspaceTools.filter((tool) => tool.name !== "run-command" && (mode === "build" || tool.sideEffect === "none"));
      return this.runLocal({
        ...request,
        tools: [...(request.tools ?? []), ...governedWorkspaceTools, ...productTools],
        ...(approvalPolicy ? { approvalPolicy } : {}),
      }, [...(request.tools ?? []), ...governedWorkspaceTools, ...productTools], events);
    }
    const selectedModel = request.runtimeModel ?? profile.model;
    if (!selectedModel) throw new AgentVError("configuration-invalid", "Choose a model before starting this task.");
    const workspaceTools = request.workspaceAccess === "workspace-write"
      ? await createWorkspaceTools({
        rootPath: request.workspacePath,
        allowedCommands: developmentCommands,
        rejectPotentialSecrets: true,
        postEditChecks: [{
          name: "Git whitespace validation",
          command: "git",
          args: ["diff", "--check", "--no-ext-diff"],
          blocking: true,
        }],
      })
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
      budget: { maxTokens: await this.contextWindow(request.runtimeId, selectedModel) },
      ...(request.trajectory ? { trajectory: request.trajectory } : {}),
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

  private async runLocal<T>(
    request: CodingRuntimeRequest<T>,
    tools: readonly AgentTool[],
    events?: EventSink,
  ): Promise<CodingRuntimeResult<T>> {
    const managed = manageAgentContext({
      input: request.input,
      tools,
      maxInputTokens: 64_000,
      ...(request.trajectory ? { trajectory: request.trajectory } : {}),
    });
    const runId = request.runId ?? crypto.randomUUID();
    const base = { runId, timestamp: new Date().toISOString(), scope: request.scope, ...(request.traceId ? { traceId: request.traceId } : {}) };
    if (managed.compaction.occurred) {
      await events?.emit({ ...base, type: "context.compacted", removedMessages: managed.compaction.removedMessages, disclosure: managed.compaction.disclosure!, usage: managed.usage });
    } else await events?.emit({ ...base, type: "context.measured", usage: managed.usage });
    const result = await this.local.run({ ...request, runId, input: managed.input }, events);
    return {
      ...result,
      usage: {
        ...(result.usage ?? {}),
        context: managed.usage,
        cost: result.usage?.cost ?? { status: "unavailable", detail: "This local runtime did not report monetary cost." },
      },
    };
  }

  private async contextWindow(runtimeId: string, modelId: string): Promise<number> {
    const profile = (await this.providers.summaries()).find((item) => item.id === runtimeId);
    const model = profile?.models.find((item) => item.id === modelId);
    return model?.contextWindow && model.contextWindow >= 8_000 ? model.contextWindow : 64_000;
  }

  private async productTools(request: CodingRuntimeRequest<unknown>, mode: string): Promise<AgentTool[]> {
    const sessionId = request.sessionId;
    if (!sessionId) return [];
    const allowedOrigins = this.browser ? await this.browser.allowedOrigins(sessionId) : [];
    const browserTools = this.browser
      ? createBrowserTools({ controller: this.browserController(sessionId), allowedOrigins, allowNavigationRequests: true })
      : [];
    const tools: AgentTool[] = [...browserTools];
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
      tools.push(createAgentTerminalPollTool({ sessionId, terminal: this.terminal }));
      tools.push(createAgentTerminalStopTool({ sessionId, terminal: this.terminal }));
    }
    return tools;
  }

  private browserController(sessionId: string): BrowserController {
    const controller = this.browser!.controller(sessionId);
    return {
      currentUrl: (options) => controller.currentUrl(options),
      snapshot: (options) => controller.snapshot(options),
      ...(controller.consoleMessages ? { consoleMessages: (options?: { abortSignal?: AbortSignal }) => controller.consoleMessages!(options) } : {}),
      ...(controller.networkRequests ? { networkRequests: (options?: { abortSignal?: AbortSignal }) => controller.networkRequests!(options) } : {}),
      ...(controller.screenshot ? { screenshot: (options?: { abortSignal?: AbortSignal }) => controller.screenshot!(options) } : {}),
      ...(controller.wait ? { wait: (target: string, options?: { abortSignal?: AbortSignal; timeoutMs?: number }) => controller.wait!(target, options) } : {}),
      navigate: (url, options) => this.runBrowserAction(options?.approvalId, () => controller.navigate(url, options)),
      click: (target, options) => this.runBrowserAction(options?.approvalId, () => controller.click(target, options)),
      type: (target, value, options) => this.runBrowserAction(options?.approvalId, () => controller.type(target, value, options)),
    };
  }

  private async runBrowserAction<T>(approvalId: string | undefined, action: () => Promise<T>): Promise<T> {
    if (!approvalId || !this.approvals) return action();
    await this.approvals.mark(approvalId, "executing");
    try {
      const result = await action();
      await this.approvals.mark(approvalId, "completed");
      return result;
    } catch (error) {
      await this.approvals.mark(approvalId, "failed", "The controlled browser action failed.");
      throw error;
    }
  }
}
