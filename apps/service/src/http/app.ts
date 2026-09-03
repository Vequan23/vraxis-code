import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CodingRuntimeEngine, CredentialStore } from "@vraxis/agent-v";
import type { McpConnectionAuthorizer } from "@vraxis/agent-v/mcp";
import { SystemCredentialStore } from "@vraxis/agent-v/node";
import { LocalCliRuntimeEngine } from "@vraxis/agent-v/local-cli";
import {
  contractVersion,
  parseAppendMessageRequest,
  parseApprovalDecisionRequest,
  parseBrowserActionRequest,
  parseCommandRequest,
  parseConnectModelProviderRequest,
  parseConnectMcpServerRequest,
  parseCreateSessionRequest,
  parseRegisterProjectRequest,
  parseUpdateSettingsRequest,
  parseUpdateMcpServerProjectsRequest,
  type AttachmentHandoffConsent,
  type ApprovalSummary,
  type PromptAttachment,
  type SessionLiveEvidenceResponse,
  type SessionStreamPayload,
  type SessionSummary,
  type TerminalRunSummary,
  type TaskProofEnvelopeV1,
  type TaskReceiptV1,
  type UnderstandArtifactEnvelopeV1,
  type WorktreeHunkSelection,
  type WorktreeSummary,
  type StartupRecoverySummary,
} from "@vraxis/code-contracts";
import { ApprovalRegistry } from "../approvals/approval-registry.js";
import { BrowserWorkspace } from "../browser/browser-workspace.js";
import type { BrowserAutomationRelay } from "../browser/browser-automation.js";
import { renderBrowserReplay } from "../browser/browser-replay.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import {
  pickProjectFolderWithSystemDialog,
  type ProjectFolderPicker,
} from "../projects/system-directory-picker.js";
import { discoverRuntimes } from "../runtimes/runtime-discovery.js";
import { RuntimeDiscoveryCache, backgroundDiscoveryTimeoutMs } from "../runtimes/runtime-discovery-cache.js";
import { withProductCapabilityMatrix } from "../runtimes/runtime-capabilities.js";
import { RuntimeConformanceRegistry } from "../runtimes/runtime-conformance.js";
import { SessionRegistry } from "../sessions/session-registry.js";
import { AgentExecutionCoordinator } from "../sessions/agent-execution.js";
import { SettingsRegistry } from "../settings/settings-registry.js";
import { ModelProviderRegistry } from "../model-providers/model-provider-registry.js";
import { McpServerRegistry, type McpConnector } from "../mcp/mcp-server-registry.js";
import { VraxisCodeRuntimeEngine } from "../runtimes/vraxis-code-runtime.js";
import { indexProjectFiles } from "../workspace/file-index.js";
import { readProjectFile } from "../workspace/read-project-file.js";
import { AttachmentStore } from "../attachments/attachment-store.js";
import { SkillRegistry, type SkillInventoryDiscovery } from "../skills/skill-registry.js";
import { GitWorktrees, WorktreeApplyConflictError } from "../worktrees/git-worktree.js";
import { TerminalRegistry } from "../terminal/terminal-registry.js";
import {
  defaultProjectInspector,
  inspectProductReport,
  inspectProductProject,
  verificationChecks as buildVerificationPlan,
  type ProjectInspector,
} from "../verification/project-inspection.js";
import { VerificationRegistry } from "../verification/verification-registry.js";
import { evaluateBrowserAssertions } from "../verification/browser-assertions.js";
import { compareVisualBaseline } from "../verification/visual-comparison.js";
import { renderTaskReceiptHtml } from "../receipts/task-receipt-html.js";
import { TaskProofSigner } from "../receipts/task-proof.js";
import { createUnderstandArtifact } from "../receipts/understand-artifact.js";
import { ProofTrustRegistry } from "../receipts/proof-trust.js";
import { TeamPolicyRegistry } from "../team-policy/team-policy-registry.js";
import { createSupportBundle } from "../diagnostics/support-bundle.js";
import { HarnessRunMetricsRegistry } from "../metrics/harness-run-metrics-registry.js";
import { exportHarnessMetrics } from "../metrics/harness-run-metrics-aggregation.js";
import { redactTaskReceipt } from "../receipts/portable-redaction.js";
import { DesktopSession } from "./desktop-session.js";
import { buildBootstrapState, parseBootstrapScope, resolveBootstrapContext } from "./bootstrap-state.js";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface AppOptions {
  dataDirectory: string;
  publicDirectory?: string;
  desktopToken?: string;
  discover?: typeof discoverRuntimes;
  runtimeDiscoveryCache?: RuntimeDiscoveryCache;
  folderPicker?: ProjectFolderPicker;
  runtimeEngine?: CodingRuntimeEngine;
  runtimeProbeEngine?: Pick<CodingRuntimeEngine, "probe">;
  credentialStore?: CredentialStore;
  providerFetch?: typeof globalThis.fetch;
  mcpConnect?: McpConnector;
  discoverSkills?: SkillInventoryDiscovery;
  browserWorkspace?: BrowserWorkspace;
  browserRelay?: BrowserAutomationRelay;
  projectInspector?: ProjectInspector;
  startupRecovery?: StartupRecoverySummary;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

async function body(request: IncomingMessage, maximumBytes = 64_000): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
    if (raw.length > maximumBytes) throw new TypeError("Request body is too large.");
  }
  return raw ? JSON.parse(raw) : {};
}

function hostIsLoopback(request: IncomingMessage): boolean {
  const host = (request.headers.host ?? "").replace(/:\d+$/, "");
  return loopbackHosts.has(host);
}

function originIsLoopback(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return loopbackHosts.has(new URL(origin).hostname); } catch { return false; }
}

export function createApp(options: AppOptions) {
  const desktopSession = options.desktopToken ? new DesktopSession(options.desktopToken) : undefined;
  const registry = new ProjectRegistry(options.dataDirectory);
  const sessions = new SessionRegistry(options.dataDirectory);
  const settings = new SettingsRegistry(options.dataDirectory);
  const credentials = options.credentialStore ?? new SystemCredentialStore({ service: "Vraxis Code" });
  const modelProviders = new ModelProviderRegistry(options.dataDirectory, credentials, options.providerFetch);
  const mcpServers = new McpServerRegistry(options.dataDirectory, credentials, options.mcpConnect);
  const importedAttachments = new AttachmentStore(options.dataDirectory);
  const skills = new SkillRegistry(options.discoverSkills);
  const worktrees = new GitWorktrees(options.dataDirectory);
  const proofSigner = new TaskProofSigner(options.dataDirectory);
  const proofTrust = new ProofTrustRegistry(options.dataDirectory);
  const teamPolicy = new TeamPolicyRegistry(options.dataDirectory, proofSigner, proofTrust);
  const approvals = new ApprovalRegistry(
    options.dataDirectory,
    (input) => teamPolicy.decision(input),
    async () => (await settings.read()).authorityMode ?? "supervised",
  );
  const terminal = new TerminalRegistry(options.dataDirectory);
  const userTerminalStarts = new Map<string, Promise<{ run: TerminalRunSummary; created: boolean }>>();
  const browser = options.browserWorkspace ?? new BrowserWorkspace(options.dataDirectory, credentials, options.browserRelay);
  const verifications = new VerificationRegistry(options.dataDirectory);
  const harnessRunMetrics = new HarnessRunMetricsRegistry(options.dataDirectory);
  async function proofTrustState() {
    return proofTrust.state(await proofSigner.identity(), await proofSigner.rotationHistory());
  }
  const projectInspector = options.projectInspector ?? defaultProjectInspector;
  async function reconcileWorktreeApplications(): Promise<void> {
    const data = await sessions.read();
    for (const session of data.sessions) {
      if (session.worktree?.status !== "applying") continue;
      const projectPath = await registry.resolveInside(session.projectId);
      const applicationState = await worktrees.applicationState(
        session.worktree,
        projectPath,
        session.worktree.applyingPaths,
        session.worktree.applyingHunks,
      ).catch(() => "conflicted" as const);
      const worktreeApprovals = (await approvals.list(session.id)).filter((item) => item.source === "worktree");
      const latestApproval = worktreeApprovals[0];
      if (applicationState === "applied") {
        const changedFileCount = (await worktrees.evidence(session.worktree)).changes.length;
        const completedPaths = [...(session.worktree.applyingPaths ?? [])];
        for (const selection of session.worktree.applyingHunks ?? []) {
          const diff = await worktrees.diff(session.worktree, selection.path);
          const combined = new Set([...(session.worktree.appliedHunks?.[selection.path] ?? []), ...selection.hunkIds]);
          if (diff.hunks.every((hunk) => combined.has(hunk.id))) completedPaths.push(selection.path);
        }
        await sessions.markWorktreeApplied(
          session.id,
          session.worktree.checkpointCommit!,
          changedFileCount,
          completedPaths,
          session.worktree.applyingHunks,
        );
        if (latestApproval) await approvals.mark(latestApproval.id, "completed");
      } else if (applicationState === "not-applied") {
        await sessions.markWorktreeApplyFailed(session.id, "Vraxis Code restarted before the checkpoint reached the project. Review it and apply again when ready.");
      } else {
        await sessions.markWorktreeStale(session.id, "The project and checkpoint both changed while application was interrupted. Inspect both versions before continuing.");
        if (latestApproval) await approvals.mark(latestApproval.id, "failed", "The interrupted apply could not be reconciled automatically.");
      }
    }
  }
  const storageRecovery = (async () => {
    await Promise.all([approvals.reconcile(), terminal.reconcile(), verifications.reconcile()]);
    await reconcileWorktreeApplications();
  })();
  async function ensureUserTerminalRun(
    sessionId: string,
    absoluteCwd: string,
    options: { force?: boolean } = {},
  ): Promise<{ run: TerminalRunSummary; created: boolean }> {
    if (!options.force) {
      const active = (await terminal.list(sessionId)).find((run) => run.purpose === "user-shell"
        && (run.status === "pending" || run.status === "running"));
      if (active) return { run: active, created: false };
      const pending = userTerminalStarts.get(sessionId);
      if (pending) return pending;
    }
    const start = (async () => {
      if (!options.force) {
        const existing = (await terminal.list(sessionId)).find((run) => run.purpose === "user-shell"
          && (run.status === "pending" || run.status === "running"));
        if (existing) return { run: existing, created: false };
      }
      const shell = process.platform === "win32"
        ? process.env.COMSPEC ?? process.env.ComSpec ?? "cmd.exe"
        : process.env.SHELL ?? "/bin/sh";
      const shellArguments = process.platform === "win32" ? [] : ["-l"];
      const baseLabel = basename(shell).replace(/\.exe$/i, "");
      const activeShellCount = (await terminal.list(sessionId)).filter((run) => run.purpose === "user-shell"
        && (run.status === "pending" || run.status === "running")).length;
      const label = activeShellCount === 0 ? baseLabel : `${baseLabel} ${activeShellCount + 1}`;
      const run = await terminal.prepare(
        sessionId,
        `user-terminal:${randomUUID()}`,
        commandText(shell, shellArguments),
        ".",
        { purpose: "user-shell", label },
      );
      void terminal.execute(run.id, absoluteCwd).catch(() => undefined);
      return { run, created: true };
    })();
    if (!options.force) userTerminalStarts.set(sessionId, start);
    try {
      return await start;
    } finally {
      if (!options.force && userTerminalStarts.get(sessionId) === start) userTerminalStarts.delete(sessionId);
    }
  }
  interface ManualAction {
    approve: () => void | Promise<void>;
    deny?: () => void | Promise<void>;
  }
  const manualActions = new Map<string, ManualAction>();
  async function registerManualAction(approval: ApprovalSummary, action: ManualAction): Promise<void> {
    if (approval.state === "approved") {
      await action.approve();
      return;
    }
    if (approval.state === "denied") {
      await action.deny?.();
      return;
    }
    manualActions.set(approval.id, action);
  }
  function approvedMcpConnection(approvalId: string): McpConnectionAuthorizer {
    return {
      async decide() {
        const approval = (await approvals.list("mcp-settings")).find((item) => item.id === approvalId);
        return approval?.state === "executing" ? "approved" : "denied";
      },
    };
  }
  const execution = new AgentExecutionCoordinator(
    sessions,
    options.runtimeEngine ?? new VraxisCodeRuntimeEngine(modelProviders, credentials, approvals, browser, terminal, verifications, mcpServers),
    importedAttachments,
    browser,
    {
      registry: harnessRunMetrics,
      enabled: async () => (await settings.read()).harnessMetricsEnabled === true,
      verificationRuns: (sessionId) => verifications.list(sessionId),
    },
  );
  const recovery = storageRecovery.then(() => execution.reconcile());
  const discover = options.discover ?? discoverRuntimes;
  const runtimeDiscoveryCache = options.runtimeDiscoveryCache ?? new RuntimeDiscoveryCache(options.dataDirectory, discover);
  void runtimeDiscoveryCache.start();
  const runtimeConformance = new RuntimeConformanceRegistry(
    options.dataDirectory,
    options.runtimeProbeEngine ?? new LocalCliRuntimeEngine(),
  );
  const discoverLocalRuntimes = async () => runtimeConformance.decorate(await runtimeDiscoveryCache.get());
  const folderPicker = options.folderPicker ?? pickProjectFolderWithSystemDialog;

  async function validateAttachmentFiles(
    resolveFile: (path: string) => Promise<string>,
    attachments: PromptAttachment[] = [],
  ): Promise<void> {
    await Promise.all(attachments.map(async (attachment) => {
      if (attachment.source === "imported") {
        await importedAttachments.validate(attachment);
        return;
      }
      const path = await resolveFile(attachment.path);
      if (!(await stat(path)).isFile()) throw new TypeError("Choose a project file to attach.");
    }));
  }

  async function validateBuildRuntime(runtimeId: string): Promise<void> {
    const runtime = [...await discoverLocalRuntimes(), ...await modelProviders.runtimes()].find((item) => item.id === runtimeId);
    if (!runtime?.capabilities?.includes("workspace-write")) {
      throw new TypeError("Choose a runtime that supports guarded isolated-workspace writes for Build mode.");
    }
  }

  async function sessionWorkspace(session: SessionSummary): Promise<string> {
    if (session.worktree && session.worktree.status !== "cleaned") return worktrees.resolveInside(session.worktree);
    return registry.resolveInside(session.projectId);
  }

  function commandText(command: string, args: readonly string[]): string {
    const quote = (value: string) => /^[a-zA-Z0-9_./:@=+-]+$/.test(value)
      ? value
      : `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return [command, ...args].map(quote).join(" ");
  }

  async function safeProjectDoctor(projectId: string, projectPath: string) {
    try { return await inspectProductProject(projectId, projectPath, projectInspector); }
    catch (error) {
      return {
        schemaVersion: 1 as const,
        projectId,
        projectName: projectId,
        projectKind: "unknown" as const,
        ecosystems: [],
        frameworks: [],
        verificationChecks: [],
        verificationServices: [],
        verificationBrowserAssertions: [],
        devServers: [],
        issues: [{
          severity: "error" as const,
          code: "inspection-failed",
          message: error instanceof Error ? error.message : "Project inspection failed.",
          remediation: "Confirm the project is readable, then inspect it again.",
        }],
        ok: false,
      };
    }
  }


  async function stopVerificationServices(runId: string): Promise<void> {
    const run = await verifications.get(runId);
    const terminalRunIds = run.services
      .filter((item) => (item.state === "starting" || item.state === "healthy") && item.terminalRunId)
      .map((item) => item.terminalRunId!);
    await verifications.markServicesStopped(runId);
    await Promise.all(terminalRunIds.map(async (id) => {
      await terminal.interrupt(id).catch(() => undefined);
    }));
  }

  async function serviceHealthStatus(url: string): Promise<number | undefined> {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(5_000),
        headers: { "user-agent": "Vraxis-Code-Health/1" },
      });
      await response.body?.cancel().catch(() => undefined);
      return response.status;
    } catch {
      return undefined;
    }
  }

  async function failVerificationService(runId: string, serviceId: string, approvalId: string, message: string): Promise<void> {
    const current = await verifications.get(runId);
    const service = current.services.find((item) => item.id === serviceId);
    if (!service || service.state === "failed" || service.state === "stopped") return;
    await verifications.failService(runId, serviceId, message);
    await approvals.mark(approvalId, "failed", message);
    await stopVerificationServices(runId);
    await sessions.verification(current.sessionId, "Service verification failed", message, "failed");
  }

  async function awaitVerificationService(
    runId: string,
    serviceId: string,
    terminalRunId: string,
    approvalId: string,
    absoluteCwd: string,
  ): Promise<void> {
    const initial = await verifications.get(runId);
    const service = initial.services.find((item) => item.id === serviceId);
    if (!service) throw new TypeError("Verification service was not found.");
    void terminal.execute(terminalRunId, absoluteCwd, undefined, 30 * 60_000).then(async (result) => {
      const current = await verifications.get(runId);
      const currentService = current.services.find((item) => item.id === serviceId);
      if (currentService?.state !== "starting" && currentService?.state !== "healthy") return;
      const output = result.output.trim().slice(-500);
      await failVerificationService(
        runId,
        serviceId,
        approvalId,
        output || `${service.title} exited before verification completed.`,
      );
    }).catch(async (error) => {
      await failVerificationService(
        runId,
        serviceId,
        approvalId,
        error instanceof Error ? error.message : `${service.title} failed to start.`,
      );
    });

    const deadline = Date.now() + service.health.timeoutMs;
    while (Date.now() < deadline) {
      const current = await verifications.get(runId);
      const currentService = current.services.find((item) => item.id === serviceId);
      if (currentService?.state !== "starting") return;
      const status = await serviceHealthStatus(service.health.url);
      if (status === service.health.expectedStatus) {
        await verifications.markServiceHealthy(runId, serviceId, status);
        await approvals.mark(approvalId, "completed");
        await sessions.verification(
          current.sessionId,
          `${service.title} is healthy`,
          `${service.health.url} returned HTTP ${status}. The process remains attached until verification finishes.`,
          "running",
        );
        const scheduled = await scheduleVerification(runId);
        if (scheduled.run.state === "passed" || scheduled.run.state === "failed") await stopVerificationServices(runId);
        return;
      }
      await verifications.recordServiceHealth(runId, serviceId, status);
      await new Promise((resolve) => setTimeout(resolve, Math.min(service.health.intervalMs, Math.max(0, deadline - Date.now()))));
    }
    await failVerificationService(
      runId,
      serviceId,
      approvalId,
      `${service.title} did not return HTTP ${service.health.expectedStatus} from ${service.health.url} within ${service.health.timeoutMs} ms.`,
    );
  }

  async function scheduleVerification(runId: string): Promise<{ run: Awaited<ReturnType<VerificationRegistry["get"]>>; approval?: ApprovalSummary }> {
    let run = await verifications.get(runId);
    if (run.state === "failed" || run.state === "passed" || run.state === "needs-browser" || run.state === "interrupted") return { run };
    const service = run.services.find((item) => item.state === "pending");
    if (service) {
      const session = await sessions.get(run.sessionId);
      const absoluteCwd = session.worktree
        ? await worktrees.resolveInside(session.worktree, service.cwd)
        : await registry.resolveInside(session.projectId, service.cwd);
      if (!(await stat(absoluteCwd)).isDirectory()) throw new TypeError("Verification service working directory must be a project folder.");
      const command = commandText(service.command, service.args);
      const approval = await approvals.request({
        sessionId: run.sessionId,
        projectId: run.projectId,
        capability: "command",
        title: `Start service · ${service.title}`,
        description: `Start the declared service, wait for its loopback health check, and retain its terminal receipt until verification finishes.`,
        scope: `${service.cwd} · ${command} · health ${service.health.url}`,
        risk: "high",
        source: "terminal",
      });
      const terminalRun = await terminal.prepare(run.sessionId, approval.id, command, service.cwd);
      run = await verifications.awaitServiceApproval(run.id, service.id, approval.id);
      await registerManualAction(approval, {
        approve: async () => {
          await approvals.mark(approval.id, "executing");
          await verifications.startService(run.id, service.id, terminalRun.id);
          void awaitVerificationService(run.id, service.id, terminalRun.id, approval.id, absoluteCwd);
        },
        deny: async () => {
          await terminal.deny(terminalRun.id);
          await verifications.failService(run.id, service.id, "The service start was denied.");
          await stopVerificationServices(run.id);
          await sessions.verification(run.sessionId, "Verification stopped", `${service.title} was not approved.`, "interrupted");
        },
      });
      return { run: await verifications.get(run.id), approval };
    }
    const check = run.checks.find((item) => item.state === "pending");
    if (!check) {
      run = await verifications.settleIfReady(run.id);
      return { run };
    }
    const session = await sessions.get(run.sessionId);
    const absoluteCwd = session.worktree
      ? await worktrees.resolveInside(session.worktree, check.cwd)
      : await registry.resolveInside(session.projectId, check.cwd);
    if (!(await stat(absoluteCwd)).isDirectory()) throw new TypeError("Verification working directory must be a project folder.");
    const command = commandText(check.command, check.args);
    const approval = await approvals.request({
      sessionId: run.sessionId,
      projectId: run.projectId,
      capability: "command",
      title: `Verify · ${check.title}`,
      description: `Run the declared ${check.category} command and retain its terminal receipt as proof.`,
      scope: `${check.cwd} · ${command}`,
      risk: "high",
      source: "terminal",
    });
    const terminalRun = await terminal.prepare(run.sessionId, approval.id, command, check.cwd);
    run = await verifications.awaitApproval(run.id, check.id, approval.id);
    await registerManualAction(approval, {
      approve: async () => {
        await approvals.mark(approval.id, "executing");
        await verifications.startCheck(run.id, check.id, terminalRun.id);
        void terminal.execute(terminalRun.id, absoluteCwd, undefined, check.timeoutMs).then(async (result) => {
          if (result.status === "success") await approvals.mark(approval.id, "completed");
          else await approvals.mark(approval.id, "failed", result.output.trim().slice(-500) || "Verification failed.");
          const completed = await verifications.finishCheck(run.id, check.id, result);
          if (completed.state === "failed") {
            await stopVerificationServices(run.id);
            await sessions.verification(run.sessionId, "Verification failed", `${check.title} did not pass. Review its terminal receipt.`, "failed");
          } else if (completed.state === "needs-browser") {
            await sessions.verification(
              run.sessionId,
              "Command checks passed",
              run.browserTarget
                ? `Open ${run.browserTarget} and capture it to complete browser verification.`
                : "Capture the current browser page to complete browser verification.",
              "complete",
            );
          } else if (completed.state === "passed") {
            await stopVerificationServices(run.id);
            await sessions.verification(run.sessionId, "Verification passed", "Every required project check passed with retained terminal evidence.", "complete");
          } else await scheduleVerification(run.id);
        }).catch(async (error) => {
          const message = error instanceof Error ? error.message : "Verification command failed to start.";
          await approvals.mark(approval.id, "failed", message);
          await verifications.finishCheck(run.id, check.id, undefined, message);
          await stopVerificationServices(run.id);
          await sessions.verification(run.sessionId, "Verification failed", message, "failed");
        });
      },
      deny: async () => {
        const denied = await terminal.deny(terminalRun.id);
        await verifications.finishCheck(run.id, check.id, denied, "The verification command was denied.");
        await stopVerificationServices(run.id);
        await sessions.verification(run.sessionId, "Verification stopped", `${check.title} was not approved.`, "interrupted");
      },
    });
    return { run: await verifications.get(run.id), approval };
  }

  async function prepareWorktree(
    session: SessionSummary | undefined,
    projectPath: string,
    projectId: string,
    title: string,
    branchSlug?: string,
  ): Promise<WorktreeSummary> {
    if (session?.worktree?.status === "active") return session.worktree;
    if (session?.worktree && !["applied", "reverted", "archived", "cleaned"].includes(session.worktree.status)) {
      throw new TypeError("Finish or recover the current Build worktree before continuing.");
    }
    const worktree = await worktrees.create(projectPath, projectId, title, branchSlug);
    if (session?.worktree) await sessions.continueBuild(session.id, worktree);
    else if (session) await sessions.attachWorktree(session.id, worktree);
    return worktree;
  }

  function validateAttachmentConsent(
    attachments: PromptAttachment[] = [],
    consent: AttachmentHandoffConsent | undefined,
    runtimeId: string,
    modelId?: string,
  ): void {
    const importedIds = attachments.filter((item) => item.source === "imported").map((item) => item.id).sort();
    if (!importedIds.length) return;
    const approvedIds = [...(consent?.attachmentIds ?? [])].sort();
    if (!consent?.confirmed || consent.runtimeId !== runtimeId || consent.modelId !== modelId
      || JSON.stringify(approvedIds) !== JSON.stringify(importedIds)) {
      throw new TypeError("Confirm the external files and selected runtime before sending.");
    }
  }

  async function sessionLiveEvidence(sessionId: string): Promise<SessionLiveEvidenceResponse> {
    const session = await sessions.get(sessionId);
    const [browserState, sessionApprovals, approvalRules, terminalRuns, verificationRuns, verificationHandoffs] = await Promise.all([
      browser.state(sessionId),
      approvals.list(sessionId),
      approvals.listRules(session.projectId, session.id),
      terminal.list(sessionId),
      verifications.list(sessionId),
      verifications.listHandoffs(sessionId),
    ]);
    return {
      approvals: sessionApprovals,
      approvalRules,
      terminalRuns,
      verificationRuns,
      verificationHandoffs,
      ...(browserState ? { browser: browserState } : {}),
    };
  }

  async function taskReceipt(sessionId: string): Promise<TaskReceiptV1> {
    const session = await sessions.get(sessionId);
    const projectData = await registry.read();
    const project = projectData.projects.find((item) => item.id === session.projectId);
    if (!project) throw new TypeError("The task project is unavailable.");
    let changes: TaskReceiptV1["changes"] = [];
    if (session.worktree && session.worktree.status !== "cleaned") {
      changes = (await worktrees.evidence(session.worktree).catch(() => ({ changes: [] }))).changes;
    }
    const browserState = await browser.state(session.id);
    return {
      kind: "vraxis.task-receipt",
      version: 1,
      generatedAt: new Date().toISOString(),
      session: {
        id: session.id,
        title: session.title,
        mode: session.mode,
        status: session.status,
        runtimeId: session.runtimeId,
        ...(session.modelId ? { modelId: session.modelId } : {}),
        updatedAt: session.updatedAt,
      },
      ...(session.settlement ? { settlement: session.settlement } : {}),
      project: { id: project.id, name: project.name, branch: project.branch },
      ...(session.worktree ? { worktree: session.worktree } : {}),
      ...(session.worktreeHistory?.length ? { worktreeHistory: session.worktreeHistory } : {}),
      changes,
      approvals: await approvals.list(session.id),
      terminalRuns: (await terminal.list(session.id)).filter((run) => run.purpose !== "user-shell"),
      verificationRuns: await verifications.list(session.id),
      verificationHandoffs: await verifications.listHandoffs(session.id),
      ...(browserState ? { browser: {
        url: browserState.url,
        title: browserState.title,
        viewport: browserState.viewport,
        actions: browserState.actions,
        console: browserState.console,
        network: browserState.network,
      } } : {}),
      activity: (await sessions.events(session.id)).events,
    };
  }

  async function taskProof(sessionId: string): Promise<TaskProofEnvelopeV1> {
    return proofSigner.create(redactTaskReceipt(await taskReceipt(sessionId)));
  }

  async function understandArtifact(sessionId: string): Promise<UnderstandArtifactEnvelopeV1> {
    return createUnderstandArtifact(await taskProof(sessionId), proofSigner);
  }

  const app = async function app(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      applySecurityHeaders(response);
      if (!hostIsLoopback(request) || !originIsLoopback(request)) {
        json(response, 403, { error: "Vraxis Code accepts requests from this device only." });
        return;
      }
      const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

      if (url.pathname === "/api/health") {
        json(response, 200, { status: "ready", contractVersion });
        return;
      }

      if (url.pathname === "/app" && desktopSession) {
        const sessionCookies = desktopSession.exchange(url.searchParams.get("desktop_token"));
        if (!sessionCookies) {
          json(response, 401, { error: "Desktop session token was rejected." });
          return;
        }
        response.writeHead(302, {
          location: "/",
          "set-cookie": sessionCookies,
          "cache-control": "no-store",
        });
        response.end();
        return;
      }

      if (url.pathname.startsWith("/api/") && desktopSession && !desktopSession.authorize(request)) {
        json(response, 401, { error: "Open Vraxis Code from its desktop window to continue." });
        return;
      }

      if (url.pathname.startsWith("/api/") && desktopSession && !desktopSession.authorizeMutation(request)) {
        json(response, 403, { error: "This desktop action is missing its request-forgery token. Reload Vraxis Code and try again." });
        return;
      }

      if (url.pathname.startsWith("/api/")) await recovery;

      if (request.method === "POST" && url.pathname === "/api/attachments") {
        const encodedName = request.headers["x-vraxis-file-name"];
        if (typeof encodedName !== "string") throw new TypeError("Choose a file to attach.");
        let name: string;
        try { name = decodeURIComponent(encodedName); } catch { throw new TypeError("The selected file name is invalid."); }
        const mediaTypeHeader = request.headers["content-type"];
        const mediaType = typeof mediaTypeHeader === "string" ? mediaTypeHeader.split(";", 1)[0] ?? "" : "";
        json(response, 201, await importedAttachments.importFile(name, mediaType, request));
        return;
      }

      const importedAttachmentMatch = /^\/api\/attachments\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if (request.method === "DELETE" && importedAttachmentMatch?.[1]) {
        await importedAttachments.remove(importedAttachmentMatch[1]);
        json(response, 200, { status: "removed" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/support-bundle") {
        const projectData = await registry.read();
        const sessionData = await sessions.read();
        const currentSettings = await settings.read();
        const bundle = createSupportBundle({
          applicationVersion: "0.1.0",
          contractVersion,
          desktopSessionProtected: Boolean(options.desktopToken),
          projects: projectData.projects,
          sessions: sessionData.sessions,
          runtimes: withProductCapabilityMatrix([...await discoverLocalRuntimes(), ...await modelProviders.runtimes()]),
          approvals: await approvals.list(),
          terminalRuns: await terminal.list(),
          verificationRuns: await verifications.list(),
          ...(options.startupRecovery ? { startupRecovery: options.startupRecovery } : {}),
          ...(currentSettings.harnessMetricsEnabled && currentSettings.harnessMetricsExportEnabled
            ? { harnessMetrics: await harnessRunMetrics.summary(true) }
            : {}),
        });
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.support-bundle+json; charset=utf-8",
          "content-disposition": `attachment; filename="vraxis-code-support-${bundle.generatedAt.slice(0, 10)}.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(bundle, null, 2)}\n`);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        const scope = parseBootstrapScope(url.searchParams.get("scope"));
        const ctx = await resolveBootstrapContext(registry, sessions);
        json(response, 200, await buildBootstrapState(scope, ctx, {
          settings,
          worktrees,
          discoverLocalRuntimes,
          modelProviders,
          mcpServers,
          skills,
          browser,
          approvals,
          terminal,
          verifications,
          safeProjectDoctor,
          ...(options.startupRecovery ? { startupRecovery: options.startupRecovery } : {}),
        }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        const input = parseRegisterProjectRequest(await body(request));
        const project = await registry.register(input.path);
        json(response, 201, project);
        return;
      }

      const projectDoctorMatch = /^\/api\/projects\/([^/]+)\/doctor$/.exec(url.pathname);
      if (request.method === "GET" && projectDoctorMatch?.[1]) {
        const projectPath = await registry.resolveInside(projectDoctorMatch[1]);
        json(response, 200, await safeProjectDoctor(projectDoctorMatch[1], projectPath));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/settings") {
        const input = parseUpdateSettingsRequest(await body(request));
        json(response, 200, await settings.update(input));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/harness-metrics") {
        const currentSettings = await settings.read();
        const windowDays = Number.parseInt(url.searchParams.get("windowDays") ?? "30", 10);
        json(response, 200, await harnessRunMetrics.summary(
          currentSettings.harnessMetricsEnabled === true,
          Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30,
        ));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/harness-metrics/export") {
        const currentSettings = await settings.read();
        if (!currentSettings.harnessMetricsEnabled) throw new TypeError("Enable harness metrics before exporting.");
        const summary = await harnessRunMetrics.summary(true);
        const exportBundle = exportHarnessMetrics(summary);
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.harness-metrics+json; charset=utf-8",
          "content-disposition": `attachment; filename="vraxis-harness-metrics-${exportBundle.generatedAt.slice(0, 10)}.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(exportBundle, null, 2)}\n`);
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/harness-metrics") {
        await harnessRunMetrics.clear();
        json(response, 200, { status: "cleared" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/runtimes/refresh") {
        json(response, 200, {
          runtimes: withProductCapabilityMatrix([
            ...await runtimeConformance.decorate(await runtimeDiscoveryCache.refresh({
              force: true,
              timeoutMs: backgroundDiscoveryTimeoutMs,
            })),
            ...await modelProviders.runtimes(),
          ]),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/proof/trust") {
        json(response, 200, await proofTrustState());
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/team-policy") {
        json(response, 200, await teamPolicy.state());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/team-policy/sign") {
        const bundle = await teamPolicy.create(await body(request));
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.team-policy+json; charset=utf-8",
          "content-disposition": `attachment; filename="vraxis-team-policy-${bundle.policyId}.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(bundle, null, 2)}\n`);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/team-policy") {
        json(response, 201, await teamPolicy.install(await body(request)));
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/api/team-policy") {
        const input = await body(request) as { confirmed?: unknown };
        json(response, 200, await teamPolicy.remove(input.confirmed === true));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/proof/trust") {
        const input = await body(request) as { label?: unknown; publicKey?: unknown };
        const signer = await proofTrust.enroll(String(input.label ?? ""), String(input.publicKey ?? ""), await proofSigner.identity());
        json(response, 201, { signer, state: await proofTrustState() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/proof/rotate") {
        const input = await body(request) as { confirmed?: unknown };
        if (input.confirmed !== true) {
          throw new TypeError("Confirm that you downloaded or copied the current public identity before rotating it.");
        }
        const attestation = await proofSigner.rotate((previous, next, rotatedAt) => (
          proofTrust.retainFormerLocalIdentity(previous, next, rotatedAt).then(() => undefined)
        ));
        json(response, 201, { attestation, state: await proofTrustState() });
        return;
      }

      const proofTrustMatch = /^\/api\/proof\/trust\/([0-9a-f]{64})$/.exec(url.pathname);
      if (request.method === "DELETE" && proofTrustMatch?.[1]) {
        const signer = await proofTrust.revoke(proofTrustMatch[1]);
        json(response, 200, { signer, state: await proofTrustState() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/proof/verify") {
        const envelope = await body(request, 8 * 1024 * 1024) as TaskProofEnvelopeV1;
        json(response, 200, await proofTrust.verify(envelope, await proofSigner.identity()));
        return;
      }

      const runtimeProbeMatch = /^\/api\/runtimes\/([^/]+)\/probe$/.exec(url.pathname);
      if (request.method === "POST" && runtimeProbeMatch?.[1]) {
        const input = await body(request) as { consent?: unknown; modelId?: unknown };
        if (input.consent !== true) throw new TypeError("Confirm the bounded provider request before verifying this harness.");
        const modelId = input.modelId === undefined ? undefined : String(input.modelId).trim();
        if (modelId && modelId.length > 200) throw new TypeError("The runtime model ID is too long.");
        const runtime = (await discoverLocalRuntimes()).find((item) => item.id === runtimeProbeMatch[1]);
        if (!runtime) throw new TypeError("The selected local harness is unavailable.");
        const conformance = await runtimeConformance.probe(runtime, modelId || undefined);
        json(response, 200, { runtimeId: runtime.id, conformance });
        return;
      }

      const runtimeMaintenanceMatch = /^\/api\/runtimes\/([^/]+)\/maintenance$/.exec(url.pathname);
      if (request.method === "POST" && runtimeMaintenanceMatch?.[1]) {
        const input = await body(request) as { projectId?: unknown; actionId?: unknown };
        const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
        const actionId = typeof input.actionId === "string" ? input.actionId.trim() : "";
        if (!projectId || !actionId) throw new TypeError("Choose a project and a runtime maintenance action.");
        const runtime = (await discoverLocalRuntimes()).find((item) => item.id === runtimeMaintenanceMatch[1]);
        if (!runtime) throw new TypeError("The selected local harness is unavailable.");
        const action = runtime.maintenanceActions?.find((item) => item.id === actionId);
        if (!action || action.kind !== "command" || !action.executable) {
          throw new TypeError("This harness action cannot run in the governed terminal.");
        }
        const projectPath = await registry.resolveInside(projectId);
        if (!(await stat(projectPath)).isDirectory()) throw new TypeError("Runtime maintenance requires an approved project folder.");
        const command = commandText(action.executable, action.arguments ?? []);
        const session = await sessions.create({
          projectId,
          mode: "ask",
          runtimeId: runtime.id,
          prompt: `Runtime Doctor: ${action.label}`,
        });
        await sessions.lifecycle(
          session.id,
          "Runtime maintenance prepared",
          `${action.label} will run without a shell inside the approved project after explicit approval.`,
          "running",
        );
        const approval = await approvals.request({
          sessionId: session.id,
          projectId,
          capability: "command",
          title: action.label,
          description: `${action.detail} Vraxis will retain the exact command, output, exit status, and approval decision.`,
          scope: `. · ${command}`,
          risk: "high",
          source: "terminal",
          rememberable: false,
        }, undefined, false);
        const run = await terminal.prepare(session.id, approval.id, command, ".");
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            void terminal.execute(run.id, projectPath).then(async (result) => {
              if (result.status === "success") {
                await approvals.mark(approval.id, "completed");
                await sessions.lifecycle(session.id, "Runtime maintenance complete", `${action.label} finished successfully. Check harness readiness again.`, "complete");
              } else {
                const failure = result.output.trim().slice(-500) || `${action.label} failed.`;
                await approvals.mark(approval.id, "failed", failure);
                await sessions.lifecycle(session.id, "Runtime maintenance failed", failure, "failed");
              }
            }).catch(async (error) => {
              const failure = error instanceof Error ? error.message : `${action.label} failed.`;
              await approvals.mark(approval.id, "failed", failure);
              await sessions.lifecycle(session.id, "Runtime maintenance failed", failure, "failed");
            });
          },
          deny: async () => {
            await terminal.deny(run.id);
            await sessions.lifecycle(session.id, "Runtime maintenance denied", `${action.label} did not run.`, "interrupted");
          },
        });
        const update = await sessions.events(session.id);
        json(response, 202, { ...update.session, events: update.events, approval, run });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/model-providers") {
        const input = parseConnectModelProviderRequest(await body(request));
        json(response, 201, await modelProviders.connect(input));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/mcp-servers") {
        const input = parseConnectMcpServerRequest(await body(request));
        await Promise.all(input.projectIds.map((projectId) => registry.resolveInside(projectId)));
        const target = input.transport === "stdio"
          ? commandText(input.command, input.args ?? [])
          : input.url;
        const approval = await approvals.request({
          sessionId: "mcp-settings",
          projectId: input.projectIds[0]!,
          capability: input.credential ? "credentials" : input.transport === "stdio" ? "command" : "network",
          title: `Connect MCP · ${input.name}`,
          description: input.transport === "stdio"
            ? "Launch this local MCP server, inspect its advertised capabilities, then stop the validation process."
            : "Contact this MCP server, inspect its advertised capabilities, then close the validation connection.",
          scope: target,
          risk: input.transport === "stdio" || input.credential ? "high" : "medium",
          source: "mcp",
          actor: "user",
          boundary: "external-server",
          rememberable: false,
        }, undefined, false);
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            try {
              await mcpServers.connect(input, (projectId) => registry.resolveInside(projectId), approvedMcpConnection(approval.id));
              await approvals.mark(approval.id, "completed");
            } catch (error) {
              const failure = error instanceof Error ? error.message : "The MCP server could not be connected.";
              await approvals.mark(approval.id, "failed", failure);
              throw error;
            }
          },
        });
        json(response, 202, { approval });
        return;
      }

      const refreshMcpMatch = /^\/api\/mcp-servers\/([^/]+)\/refresh$/.exec(url.pathname);
      if (request.method === "POST" && refreshMcpMatch?.[1]) {
        const context = await mcpServers.approvalContext(refreshMcpMatch[1]);
        const approval = await approvals.request({
          sessionId: "mcp-settings",
          projectId: context.projectId,
          capability: context.credentialConfigured ? "credentials" : context.transport === "stdio" ? "command" : "network",
          title: `Refresh MCP · ${context.name}`,
          description: context.transport === "stdio"
            ? "Launch this local MCP server again and refresh its capability inventory."
            : "Reconnect to this MCP server and refresh its capability inventory.",
          scope: context.target,
          risk: context.transport === "stdio" || context.credentialConfigured ? "high" : "medium",
          source: "mcp",
          actor: "user",
          boundary: "external-server",
          rememberable: false,
        }, undefined, false);
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            try {
              await mcpServers.refresh(refreshMcpMatch[1]!, (projectId) => registry.resolveInside(projectId), approvedMcpConnection(approval.id));
              await approvals.mark(approval.id, "completed");
            } catch (error) {
              const failure = error instanceof Error ? error.message : "The MCP server could not be refreshed.";
              await approvals.mark(approval.id, "failed", failure);
              throw error;
            }
          },
        });
        json(response, 202, { approval });
        return;
      }

      const updateMcpProjectsMatch = /^\/api\/mcp-servers\/([^/]+)\/projects$/.exec(url.pathname);
      if (request.method === "POST" && updateMcpProjectsMatch?.[1]) {
        const input = parseUpdateMcpServerProjectsRequest(await body(request));
        json(response, 200, await mcpServers.updateProjects(
          updateMcpProjectsMatch[1],
          input.projectIds,
          (projectId) => registry.resolveInside(projectId),
        ));
        return;
      }

      const removeMcpMatch = /^\/api\/mcp-servers\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && removeMcpMatch?.[1]) {
        await mcpServers.remove(removeMcpMatch[1]);
        json(response, 200, { status: "removed" });
        return;
      }

      const refreshProviderMatch = /^\/api\/model-providers\/([^/]+)\/refresh$/.exec(url.pathname);
      if (request.method === "POST" && refreshProviderMatch?.[1]) {
        json(response, 200, await modelProviders.refresh(refreshProviderMatch[1]));
        return;
      }

      const removeProviderMatch = /^\/api\/model-providers\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && removeProviderMatch?.[1]) {
        await modelProviders.remove(removeProviderMatch[1]);
        json(response, 200, { status: "removed" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/projects/pick-folder") {
        const path = await folderPicker();
        if (!path) {
          json(response, 200, { cancelled: true });
          return;
        }
        const project = await registry.register(path);
        json(response, 200, { cancelled: false, project });
        return;
      }

      const selectProjectMatch = /^\/api\/projects\/([^/]+)\/select$/.exec(url.pathname);
      if (request.method === "POST" && selectProjectMatch?.[1]) {
        await registry.select(selectProjectMatch[1]);
        json(response, 200, { status: "selected" });
        return;
      }

      const newTaskMatch = /^\/api\/projects\/([^/]+)\/new-task$/.exec(url.pathname);
      if (request.method === "POST" && newTaskMatch?.[1]) {
        await registry.resolveInside(newTaskMatch[1]);
        await sessions.startDraft(newTaskMatch[1]);
        json(response, 200, { status: "ready", projectId: newTaskMatch[1] });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/sessions") {
        const input = parseCreateSessionRequest(await body(request));
        const projectPath = await registry.resolveInside(input.projectId);
        await validateAttachmentFiles((path) => registry.resolveInside(input.projectId, path), input.attachments);
        validateAttachmentConsent(input.attachments, input.attachmentConsent, input.runtimeId, input.modelId);
        let worktree: WorktreeSummary | undefined;
        if (input.mode === "build") {
          await validateBuildRuntime(input.runtimeId);
          worktree = await prepareWorktree(undefined, projectPath, input.projectId, input.prompt, input.branchSlug);
        }
        const executionPath = worktree ? await worktrees.resolveInside(worktree) : projectPath;
        const selectedSkills = await skills.resolve(projectPath, input.skillIds);
        const session = await sessions.create(input, selectedSkills.map((item) => item.reference), worktree);
        await execution.start(session, executionPath, input.prompt, input.attachments, selectedSkills);
        const update = await sessions.events(session.id);
        json(response, 201, { ...update.session, events: update.events });
        return;
      }

      const selectSessionMatch = /^\/api\/sessions\/([^/]+)\/select$/.exec(url.pathname);
      if (request.method === "POST" && selectSessionMatch?.[1]) {
        const selectedSession = await sessions.get(selectSessionMatch[1]);
        await registry.select(selectedSession.projectId);
        await sessions.select(selectedSession.id);
        json(response, 200, { status: "selected" });
        return;
      }

      const appendMessageMatch = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
      if (request.method === "POST" && appendMessageMatch?.[1]) {
        const input = parseAppendMessageRequest(await body(request));
        let session = await sessions.get(appendMessageMatch[1]);
        const projectPath = await registry.resolveInside(session.projectId);
        const runtimeId = input.runtimeId ?? session.runtimeId;
        const modelId = input.modelId === null ? undefined : input.modelId ?? session.modelId;
        const nextMode = input.mode ?? session.mode;
        validateAttachmentConsent(input.attachments, input.attachmentConsent, runtimeId, modelId);
        if (nextMode === "build") {
          await validateBuildRuntime(runtimeId);
          if (!session.worktree || session.worktree.status !== "active") {
            await validateAttachmentFiles((path) => registry.resolveInside(session.projectId, path), input.attachments);
            await prepareWorktree(session, projectPath, session.projectId, input.prompt, input.branchSlug);
            session = await sessions.get(session.id);
          }
        }
        const executionPath = await sessionWorkspace(session);
        if (session.worktree || nextMode !== "build") {
          await validateAttachmentFiles(
            (path) => session.worktree ? worktrees.resolveInside(session.worktree, path) : registry.resolveInside(session.projectId, path),
            input.attachments,
          );
        }
        const selectedSkills = await skills.resolve(projectPath, input.skillIds);
        if (session.status === "running") {
          const delivery = input.delivery ?? "queue";
          const event = await sessions.steer(appendMessageMatch[1], input, selectedSkills.map((item) => item.reference), delivery);
          const updatedSession = await sessions.get(appendMessageMatch[1]);
          await execution.steer({
            sessionId: updatedSession.id,
            projectPath: executionPath,
            prompt: input.prompt,
            attachments: input.attachments ?? [],
            skills: selectedSkills,
            eventId: event.id,
            delivery,
          });
          const update = await sessions.events(updatedSession.id, event.sequence - 1);
          json(response, 202, { ...update.session, events: update.events });
          return;
        }
        const event = await sessions.append(appendMessageMatch[1], input, selectedSkills.map((item) => item.reference));
        const updatedSession = await sessions.get(appendMessageMatch[1]);
        await execution.start(updatedSession, executionPath, input.prompt, input.attachments, selectedSkills);
        const update = await sessions.events(updatedSession.id, event.sequence - 1);
        json(response, 201, { ...update.session, events: update.events });
        return;
      }

      const sessionEventsMatch = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
      if (request.method === "GET" && sessionEventsMatch?.[1]) {
        const after = Number(url.searchParams.get("after") ?? "0");
        if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Event sequence must be a non-negative integer.");
        json(response, 200, await sessions.events(sessionEventsMatch[1], after));
        return;
      }

      const sessionStreamMatch = /^\/api\/sessions\/([^/]+)\/stream$/.exec(url.pathname);
      if (request.method === "GET" && sessionStreamMatch?.[1]) {
        const sessionId = sessionStreamMatch[1];
        const buffered: Parameters<Parameters<typeof sessions.subscribe>[1]>[0][] = [];
        let ready = false;
        let closed = false;
        let delivery = Promise.resolve();
        const liveEvidenceTtlMs = 200;
        let cachedLiveEvidence: SessionLiveEvidenceResponse | undefined;
        let cachedLiveEvidenceAt = 0;
        const liveEvidence = async (force = false): Promise<SessionLiveEvidenceResponse> => {
          const now = Date.now();
          if (force || !cachedLiveEvidence || now - cachedLiveEvidenceAt >= liveEvidenceTtlMs) {
            cachedLiveEvidence = await sessionLiveEvidence(sessionId);
            cachedLiveEvidenceAt = now;
          }
          return cachedLiveEvidence;
        };
        const needsFreshEvidence = (update: Parameters<Parameters<typeof sessions.subscribe>[1]>[0]) =>
          update.events.some((event) => event.kind === "approval" && event.state === "pending");
        const send = (event: "snapshot" | "update", payload: SessionStreamPayload) => {
          if (closed || response.writableEnded) return;
          try {
            response.write(`id: ${payload.cursor}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
          } catch {
            closed = true;
          }
        };
        const deliver = (update: Parameters<Parameters<typeof sessions.subscribe>[1]>[0]) => {
          delivery = delivery.then(async () => {
            if (closed || response.writableEnded) return;
            send("update", { ...update, evidence: await liveEvidence(needsFreshEvidence(update)) });
          }).catch(() => {
            if (!closed && !response.writableEnded) {
              try { response.write("event: refresh\ndata: {}\n\n"); } catch { closed = true; }
            }
          });
        };
        const unsubscribe = sessions.subscribe(sessionId, (update) => {
          if (ready) deliver(update);
          else buffered.push(update);
        });
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        try {
          const snapshot = await sessions.streamSnapshot(sessionId);
          const evidence = await sessionLiveEvidence(sessionId);
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write("retry: 1000\n\n");
          send("snapshot", { ...snapshot, evidence });
          ready = true;
          for (const update of buffered) {
            if (JSON.stringify(update.session) !== JSON.stringify(snapshot.session)
              || update.cursor > snapshot.cursor || update.events.some((event) => {
              const snapshotted = snapshot.events.find((item) => item.id === event.id);
              return !snapshotted || JSON.stringify(snapshotted) !== JSON.stringify(event);
            })) {
              deliver(update);
            }
          }
          heartbeat = setInterval(() => {
            if (closed || response.writableEnded) return;
            try { response.write(": keep-alive\n\n"); } catch { closed = true; }
          }, 15_000);
          heartbeat.unref();
        } catch (error) {
          unsubscribe();
          if (response.headersSent) {
            if (!closed && !response.writableEnded) {
              try { response.end(); } catch { /* The client already left the stream. */ }
            }
            return;
          }
          throw error;
        }
        request.once("close", () => {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      const liveEvidenceMatch = /^\/api\/sessions\/([^/]+)\/live-evidence$/.exec(url.pathname);
      if (request.method === "GET" && liveEvidenceMatch?.[1]) {
        json(response, 200, await sessionLiveEvidence(liveEvidenceMatch[1]));
        return;
      }

      const taskReceiptMatch = /^\/api\/sessions\/([^/]+)\/receipt$/.exec(url.pathname);
      if (request.method === "GET" && taskReceiptMatch?.[1]) {
        json(response, 200, await taskReceipt(taskReceiptMatch[1]));
        return;
      }

      const taskProofMatch = /^\/api\/sessions\/([^/]+)\/proof\.json$/.exec(url.pathname);
      if (request.method === "GET" && taskProofMatch?.[1]) {
        const proof = await taskProof(taskProofMatch[1]);
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.task-proof+json; charset=utf-8",
          "content-disposition": `attachment; filename="${proof.receipt.project.name.replace(/[^a-z0-9._-]+/gi, "-")}-${proof.receipt.session.id.slice(0, 8)}-proof.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(proof)}\n`);
        return;
      }

      const understandArtifactMatch = /^\/api\/sessions\/([^/]+)\/understand\.json$/.exec(url.pathname);
      if (request.method === "GET" && understandArtifactMatch?.[1]) {
        const artifact = await understandArtifact(understandArtifactMatch[1]);
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.understand+json; charset=utf-8",
          "content-disposition": `attachment; filename="${artifact.project.name.replace(/[^a-z0-9._-]+/gi, "-")}-${artifact.session.id.slice(0, 8)}-understand.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(artifact)}\n`);
        return;
      }

      const taskReceiptHtmlMatch = /^\/api\/sessions\/([^/]+)\/receipt\.html$/.exec(url.pathname);
      if (request.method === "GET" && taskReceiptHtmlMatch?.[1]) {
        const proof = await taskProof(taskReceiptHtmlMatch[1]);
        const receipt = proof.receipt;
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="${receipt.project.name.replace(/[^a-z0-9._-]+/gi, "-")}-${receipt.session.id.slice(0, 8)}-proof.html"`,
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        response.end(renderTaskReceiptHtml(receipt, proof));
        return;
      }

      const browserReplayMatch = /^\/api\/sessions\/([^/]+)\/browser-replay\.html$/.exec(url.pathname);
      if (request.method === "GET" && browserReplayMatch?.[1]) {
        const browserState = await browser.state(browserReplayMatch[1]);
        if (!browserState) throw new TypeError("This task does not have browser evidence to export.");
        const replay = await renderBrowserReplay(browserState, (frameId) => readFile(browser.framePath(browserReplayMatch[1]!, frameId)));
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-disposition": `attachment; filename="vraxis-${browserReplayMatch[1].slice(0, 8)}-browser-replay.html"`,
          "content-security-policy": replay.contentSecurityPolicy,
          "x-content-type-options": "nosniff",
          "cache-control": "no-store",
        });
        response.end(replay.html);
        return;
      }

      const interruptSessionMatch = /^\/api\/sessions\/([^/]+)\/interrupt$/.exec(url.pathname);
      if (request.method === "POST" && interruptSessionMatch?.[1]) {
        await execution.interrupt(interruptSessionMatch[1]);
        json(response, 200, { status: "interrupted" });
        return;
      }

      const resumeSessionMatch = /^\/api\/sessions\/([^/]+)\/resume$/.exec(url.pathname);
      if (request.method === "POST" && resumeSessionMatch?.[1]) {
        const session = await sessions.get(resumeSessionMatch[1]);
        const projectPath = await registry.resolveInside(session.projectId);
        if (session.mode === "build") {
          if (session.worktree && session.worktree.status !== "active") {
            throw new TypeError("These changes were already applied. Start a new Build task for additional edits.");
          }
          await validateBuildRuntime(session.runtimeId);
        }
        const executionPath = await sessionWorkspace(session);
        const pending = await sessions.nextSteeringInput(session.id);
        const input = pending ?? await sessions.lastUserInput(session.id);
        await validateAttachmentFiles(
          (path) => session.worktree ? worktrees.resolveInside(session.worktree, path) : registry.resolveInside(session.projectId, path),
          input.attachments,
        );
        const selectedSkills = await skills.resolve(projectPath, input.skillIds);
        await execution.resume(session.id, executionPath, selectedSkills, pending);
        json(response, 202, { status: "running" });
        return;
      }

      const filesMatch = /^\/api\/projects\/([^/]+)\/files$/.exec(url.pathname);
      if (request.method === "GET" && filesMatch?.[1]) {
        const root = await registry.resolveInside(filesMatch[1]);
        json(response, 200, { files: await indexProjectFiles(root) });
        return;
      }

      const sessionWorkspaceMatch = /^\/api\/sessions\/([^/]+)\/workspace$/.exec(url.pathname);
      if (request.method === "GET" && sessionWorkspaceMatch?.[1]) {
        const session = await sessions.get(sessionWorkspaceMatch[1]);
        if (session.worktree) {
          if (session.worktree.status === "cleaned") {
            json(response, 200, { files: [], changes: [], worktree: session.worktree });
            return;
          }
          json(response, 200, await worktrees.evidence(session.worktree));
        } else {
          const root = await registry.resolveInside(session.projectId);
          json(response, 200, { files: await indexProjectFiles(root), changes: [] });
        }
        return;
      }

      const applyWorktreeMatch = /^\/api\/sessions\/([^/]+)\/worktree\/apply$/.exec(url.pathname);
      if (request.method === "POST" && applyWorktreeMatch?.[1]) {
        const input = await body(request) as { paths?: unknown; hunks?: unknown };
        const session = await sessions.get(applyWorktreeMatch[1]);
        if (session.status === "running") throw new TypeError("Wait for the agent to finish before applying changes.");
        if (!session.worktree) throw new TypeError("This task does not have isolated Build changes.");
        if (session.worktree.status !== "active" && session.worktree.status !== "conflicted") {
          throw new TypeError("These Build changes are not available to apply.");
        }
        const projectPath = await registry.resolveInside(session.projectId);
        const evidence = await worktrees.evidence(session.worktree);
        if (!evidence.changes.length) throw new TypeError("This Build has no changes to apply.");
        const alreadyApplied = new Set(session.worktree.appliedPaths ?? []);
        const remainingPaths = evidence.changes.map((item) => item.path).filter((path) => !alreadyApplied.has(path));
        const requestedPaths = input.paths === undefined && input.hunks === undefined ? remainingPaths : input.paths === undefined ? [] : Array.isArray(input.paths)
          ? input.paths.map(String)
          : (() => { throw new TypeError("Selected paths must be an array."); })();
        if (requestedPaths.some((path) => !remainingPaths.includes(path)) || new Set(requestedPaths).size !== requestedPaths.length) {
          throw new TypeError("Choose unique, unapplied Build files.");
        }
        const rawHunks = input.hunks === undefined ? [] : Array.isArray(input.hunks)
          ? input.hunks
          : (() => { throw new TypeError("Selected hunks must be an array."); })();
        const requestedHunks: WorktreeHunkSelection[] = [];
        const selectedHunkPaths = new Set<string>();
        for (const raw of rawHunks) {
          if (!raw || typeof raw !== "object") throw new TypeError("Each hunk selection must identify a file and checkpoint hunks.");
          const candidate = raw as { path?: unknown; hunkIds?: unknown };
          const path = String(candidate.path ?? "");
          const hunkIds = Array.isArray(candidate.hunkIds) ? candidate.hunkIds.map(String) : [];
          if (!remainingPaths.includes(path) || requestedPaths.includes(path) || selectedHunkPaths.has(path)) {
            throw new TypeError("Choose each unapplied Build file only once.");
          }
          const diff = await worktrees.diff(session.worktree, path);
          const alreadyAppliedHunks = new Set(session.worktree.appliedHunks?.[path] ?? []);
          const availableHunks = new Set(diff.hunks.filter((hunk) => !alreadyAppliedHunks.has(hunk.id)).map((hunk) => hunk.id));
          if (!diff.partialSelection || !hunkIds.length || new Set(hunkIds).size !== hunkIds.length
            || hunkIds.some((id) => !availableHunks.has(id))) {
            throw new TypeError("Choose one or more unapplied checkpoint hunks from a text modification.");
          }
          selectedHunkPaths.add(path);
          requestedHunks.push({ path, hunkIds });
        }
        if (!requestedPaths.length && !requestedHunks.length) throw new TypeError("Choose one or more unapplied Build changes.");
        const selectedHunkCount = requestedHunks.reduce((count, item) => count + item.hunkIds.length, 0);
        const selectionScope = [
          ...(requestedPaths.length ? [`${requestedPaths.length} ${requestedPaths.length === 1 ? "file" : "files"}`] : []),
          ...(selectedHunkCount ? [`${selectedHunkCount} ${selectedHunkCount === 1 ? "hunk" : "hunks"}`] : []),
        ].join(" + ");
        const approval = await approvals.request({
          sessionId: session.id,
          projectId: session.projectId,
          capability: "write",
          title: "Apply Build changes",
          description: "Checkpoint the isolated branch, then apply these reviewed changes to the approved project without committing them.",
          scope: `${selectionScope} → ${projectPath}`,
          risk: "high",
          source: "worktree",
        });
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            void (async () => {
              let projectApplied = false;
              try {
                const checkpointCommit = session.worktree!.status === "conflicted" && session.worktree!.checkpointCommit
                  ? session.worktree!.checkpointCommit
                  : await worktrees.checkpoint(session.worktree!, session.title);
                await sessions.markWorktreeApplying(session.id, checkpointCommit, requestedPaths, requestedHunks);
                const applyingSession = await sessions.get(session.id);
                await worktrees.applyCheckpoint(applyingSession.worktree!, projectPath, checkpointCommit, requestedPaths, requestedHunks);
                projectApplied = true;
                const completedPaths = [...requestedPaths];
                for (const selection of requestedHunks) {
                  const diff = await worktrees.diff(applyingSession.worktree!, selection.path);
                  const combined = new Set([
                    ...(applyingSession.worktree!.appliedHunks?.[selection.path] ?? []),
                    ...selection.hunkIds,
                  ]);
                  if (diff.hunks.every((hunk) => combined.has(hunk.id))) completedPaths.push(selection.path);
                }
                await sessions.markWorktreeApplied(
                  session.id,
                  checkpointCommit,
                  evidence.changes.length,
                  completedPaths,
                  requestedHunks,
                );
                await approvals.mark(approval.id, "completed");
              } catch (error) {
                const message = error instanceof Error ? error.message : "Build changes could not be applied.";
                const conflicts = error instanceof WorktreeApplyConflictError ? error.conflicts : [];
                if (!projectApplied) await sessions.markWorktreeApplyFailed(session.id, message, conflicts).catch(() => undefined);
                await approvals.mark(
                  approval.id,
                  "failed",
                  projectApplied ? "The project was updated, but its completion record could not be saved. Reopen Vraxis Code to reconcile it." : message,
                );
              }
            })();
          },
        });
        json(response, 202, { approval });
        return;
      }

      const worktreeLifecycleMatch = /^\/api\/sessions\/([^/]+)\/worktree\/(archive|restore|revert|cleanup)$/.exec(url.pathname);
      if (request.method === "POST" && worktreeLifecycleMatch?.[1] && worktreeLifecycleMatch[2]) {
        const session = await sessions.get(worktreeLifecycleMatch[1]);
        if (!session.worktree) throw new TypeError("This task does not have isolated Build changes.");
        const action = worktreeLifecycleMatch[2];
        const projectPath = await registry.resolveInside(session.projectId);
        if (action === "archive") {
          let checkpointCommit = session.worktree.checkpointCommit;
          if (session.worktree.status === "active") {
            const evidence = await worktrees.evidence(session.worktree);
            if (evidence.changes.length) checkpointCommit = await worktrees.checkpoint(session.worktree, session.title);
          }
          json(response, 200, { session: await sessions.archiveWorktree(session.id, checkpointCommit) });
          return;
        }
        if (action === "restore") {
          const restoredPath = await worktrees.restore(session.worktree, projectPath);
          json(response, 200, { session: await sessions.restoreWorktree(session.id, restoredPath) });
          return;
        }
        const approval = await approvals.request({
          sessionId: session.id,
          projectId: session.projectId,
          capability: action === "cleanup" ? "destructive" : "write",
          title: action === "cleanup" ? "Clean archived worktree" : "Revert applied changes",
          description: action === "cleanup"
            ? "Remove the archived local worktree while preserving its checkpoint branch for later restore."
            : "Reverse the exact reviewed checkpoint from the approved project while preserving the recovery branch.",
          scope: action === "cleanup" ? session.worktree.path : projectPath,
          risk: "high",
          source: "worktree",
          rememberable: false,
        }, undefined, false);
        manualActions.set(approval.id, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            try {
              if (action === "cleanup") {
                await worktrees.cleanup(session.worktree!, projectPath);
                await sessions.markWorktreeCleaned(session.id);
              } else {
                await worktrees.revertCheckpoint(session.worktree!, projectPath);
                await sessions.markWorktreeReverted(session.id);
              }
              await approvals.mark(approval.id, "completed");
            } catch (error) {
              await approvals.mark(approval.id, "failed", error instanceof Error ? error.message : "Worktree action failed.");
            }
          },
        });
        json(response, 202, { approval });
        return;
      }

      const sessionDiffMatch = /^\/api\/sessions\/([^/]+)\/diff$/.exec(url.pathname);
      if (request.method === "GET" && sessionDiffMatch?.[1]) {
        const session = await sessions.get(sessionDiffMatch[1]);
        if (!session.worktree) throw new TypeError("This task does not have an isolated Build worktree.");
        const requestedPath = url.searchParams.get("path")?.trim();
        if (!requestedPath) throw new TypeError("Diff path must be a non-empty string.");
        json(response, 200, await worktrees.diff(session.worktree, requestedPath));
        return;
      }

      const sessionFileMatch = /^\/api\/sessions\/([^/]+)\/file$/.exec(url.pathname);
      if (request.method === "GET" && sessionFileMatch?.[1]) {
        const session = await sessions.get(sessionFileMatch[1]);
        const requestedPath = url.searchParams.get("path")?.trim();
        if (!requestedPath) throw new TypeError("File path must be a non-empty string.");
        const file = session.worktree
          ? await worktrees.resolveInside(session.worktree, requestedPath)
          : await registry.resolveInside(session.projectId, requestedPath);
        json(response, 200, await readProjectFile(file, requestedPath));
        return;
      }

      const fileMatch = /^\/api\/projects\/([^/]+)\/file$/.exec(url.pathname);
      if (request.method === "GET" && fileMatch?.[1]) {
        const requestedPath = url.searchParams.get("path")?.trim();
        if (!requestedPath) throw new TypeError("File path must be a non-empty string.");
        const file = await registry.resolveInside(fileMatch[1], requestedPath);
        json(response, 200, await readProjectFile(file, requestedPath));
        return;
      }

      const verificationMatch = /^\/api\/sessions\/([^/]+)\/verifications$/.exec(url.pathname);
      if (request.method === "POST" && verificationMatch?.[1]) {
        const session = await sessions.get(verificationMatch[1]);
        const input = await body(request) as { handoffId?: unknown };
        const handoffId = typeof input.handoffId === "string" ? input.handoffId.trim() : "";
        if (handoffId) {
          const handoff = (await verifications.listHandoffs(session.id)).find((item) => item.id === handoffId);
          if (!handoff || handoff.state !== "requested") throw new TypeError("The requested verification handoff is unavailable.");
        }
        const workspace = await sessionWorkspace(session);
        const report = await inspectProductReport(workspace, projectInspector);
        const changedPaths = session.worktree
          ? (await worktrees.evidence(session.worktree)).changes.map((item) => item.path)
          : [];
        const plan = buildVerificationPlan(report, changedPaths);
        const run = await verifications.create({
          sessionId: session.id,
          projectId: session.projectId,
          projectName: report.projectName,
          changedPaths,
          services: plan.services,
          checks: plan.checks,
          browserAssertions: plan.browserAssertions,
          ...(plan.visual ? { visual: plan.visual } : {}),
          browserRecommended: plan.browserRecommended,
          ...(plan.browserTarget ? { browserTarget: plan.browserTarget } : {}),
        });
        await sessions.verification(
          session.id,
          handoffId ? "Agent verification handoff accepted" : "Verification started",
          `${plan.services.length} ${plan.services.length === 1 ? "service" : "services"} and ${plan.checks.length} required ${plan.checks.length === 1 ? "check" : "checks"} will run through the approval lifecycle. The project-owned recipe, not the agent, selected them.`,
          "running",
        );
        const handoff = handoffId ? await verifications.resolveHandoff(handoffId, "accepted", run.id) : undefined;
        const scheduled = await scheduleVerification(run.id);
        json(response, 202, { ...scheduled, ...(handoff ? { handoff } : {}) });
        return;
      }

      const verificationHandoffDismissMatch = /^\/api\/verification-handoffs\/([0-9a-f-]{36})\/dismiss$/.exec(url.pathname);
      if (request.method === "POST" && verificationHandoffDismissMatch?.[1]) {
        const handoff = await verifications.resolveHandoff(verificationHandoffDismissMatch[1], "dismissed");
        await sessions.verification(
          handoff.sessionId,
          "Agent verification handoff dismissed",
          "No commands, services, or browser actions were started.",
          "complete",
        );
        json(response, 200, { handoff });
        return;
      }

      const verificationRerunMatch = /^\/api\/verifications\/([0-9a-f-]{36})\/rerun$/.exec(url.pathname);
      if (request.method === "POST" && verificationRerunMatch?.[1]) {
        const source = await verifications.get(verificationRerunMatch[1]);
        const session = await sessions.get(source.sessionId);
        const changedPaths = session.worktree
          ? (await worktrees.evidence(session.worktree)).changes.map((item) => item.path)
          : [];
        const run = await verifications.rerun(source.id, changedPaths);
        await sessions.verification(
          session.id,
          "Verification recipe rerun",
          `Running the same ${run.recipeFingerprint.slice(0, 12)} recipe through fresh approvals and receipts.`,
          "running",
        );
        const scheduled = await scheduleVerification(run.id);
        json(response, 202, scheduled);
        return;
      }

      const verificationBrowserMatch = /^\/api\/verifications\/([0-9a-f-]{36})\/browser$/.exec(url.pathname);
      if (request.method === "POST" && verificationBrowserMatch?.[1]) {
        const run = await verifications.get(verificationBrowserMatch[1]);
        const existing = await browser.state(run.sessionId);
        if (!existing || !/^https?:\/\//.test(existing.url)) throw new TypeError("Open the page you want to prove in the task browser first.");
        if (run.browserTarget && new URL(existing.url).href !== new URL(run.browserTarget).href) {
          throw new TypeError(`Open the configured verification target (${run.browserTarget}) before capturing proof.`);
        }
        const browserState = await browser.perform({ sessionId: run.sessionId, action: "capture" }, { actor: "user" });
        const action = browserState.actions[0];
        if (!action || action.action !== "capture" || action.status !== "success") throw new TypeError("Browser proof could not be captured.");
        const evidenceStartedAt = Date.parse(run.startedAt ?? run.createdAt);
        const isCurrentEvidence = (timestamp: string) => Date.parse(timestamp) >= evidenceStartedAt;
        const consoleErrors = browserState.console.filter((item) => isCurrentEvidence(item.timestamp) && item.level === "error").length;
        const networkErrors = browserState.network.filter((item) => isCurrentEvidence(item.timestamp) && (item.state === "error" || item.state === "blocked")).length;
        const assertionResults = evaluateBrowserAssertions(run.browserAssertions, browserState);
        let visualResult;
        if (run.visual) {
          try {
            const session = await sessions.get(run.sessionId);
            const baselinePath = session.worktree
              ? await worktrees.resolveInside(session.worktree, run.visual.baselinePath)
              : await registry.resolveInside(session.projectId, run.visual.baselinePath);
            visualResult = await compareVisualBaseline(
              baselinePath,
              browser.screenshotPath(run.sessionId),
              join(options.dataDirectory, "verification-visuals", `${run.id}.png`),
              run.visual.maxDiffRatio,
            );
          } catch (error) {
            visualResult = { passed: false, diffAvailable: false, failure: error instanceof Error ? error.message : "Visual comparison failed." };
          }
        }
        const completed = await verifications.recordBrowser(
          run.id,
          action.id,
          consoleErrors,
          networkErrors,
          assertionResults,
          visualResult,
          {
            url: browserState.url,
            title: browserState.title,
            capturedAt: action.timestamp,
            screenshotVersion: browserState.screenshotVersion,
            consoleErrors,
            networkErrors,
            actionCount: browserState.actions.length,
          },
        );
        await stopVerificationServices(run.id);
        await sessions.verification(
          run.sessionId,
          completed.state === "passed" ? "Verification passed" : "Browser proof needs review",
          completed.state === "passed"
            ? "Required commands passed and the captured page has no console or network errors."
            : completed.browserFailure ?? "The browser evidence contains errors.",
          completed.state === "passed" ? "complete" : "failed",
        );
        json(response, 200, { run: completed, browser: browserState });
        return;
      }

      const verificationVisualMatch = /^\/api\/verifications\/([0-9a-f-]{36})\/visual-diff$/.exec(url.pathname);
      if (request.method === "GET" && verificationVisualMatch?.[1]) {
        const run = await verifications.get(verificationVisualMatch[1]);
        if (!run.visual?.diffAvailable) throw new TypeError("This verification does not have a visual diff artifact.");
        const file = join(options.dataDirectory, "verification-visuals", `${run.id}.png`);
        if (!(await stat(file)).isFile()) throw new TypeError("The visual diff artifact is unavailable.");
        response.writeHead(200, { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
        createReadStream(file).pipe(response);
        return;
      }

      const verificationStopMatch = /^\/api\/verifications\/([0-9a-f-]{36})\/stop$/.exec(url.pathname);
      if (request.method === "POST" && verificationStopMatch?.[1]) {
        const run = await verifications.get(verificationStopMatch[1]);
        for (const approvalId of [
          ...run.services.map((item) => item.approvalId),
          ...run.checks.map((item) => item.approvalId),
        ].filter((item): item is string => Boolean(item))) {
          const approval = (await approvals.list(run.sessionId)).find((item) => item.id === approvalId);
          if (approval?.state === "pending" || approval?.state === "approved" || approval?.state === "executing") {
            await approvals.mark(approvalId, "interrupted", "Verification was stopped by the user.");
            manualActions.delete(approvalId);
          }
        }
        const interrupted = await verifications.interrupt(run.id);
        await stopVerificationServices(run.id);
        await sessions.verification(run.sessionId, "Verification stopped", "Services were torn down and pending proof was interrupted.", "interrupted");
        json(response, 200, { run: await verifications.get(interrupted.id) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/commands") {
        const input = parseCommandRequest(await body(request));
        const session = await sessions.get(input.sessionId);
        const absoluteCwd = session.worktree
          ? await worktrees.resolveInside(session.worktree, input.cwd)
          : await registry.resolveInside(session.projectId, input.cwd);
        if (!(await stat(absoluteCwd)).isDirectory()) throw new TypeError("Command working directory must be a project folder.");
        const approval = await approvals.request({
          sessionId: input.sessionId,
          projectId: session.projectId,
          capability: "command",
          title: `Run ${input.command}`,
          description: "Run this executable without a shell inside the approved session workspace.",
          scope: `${input.cwd ?? "."} · ${input.command}`,
          risk: "high",
          source: "terminal",
        });
        const run = await terminal.prepare(input.sessionId, approval.id, input.command, input.cwd ?? ".");
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            void terminal.execute(run.id, absoluteCwd).then(async (result) => {
              if (result.status === "success") await approvals.mark(approval.id, "completed");
              else await approvals.mark(approval.id, "failed", result.output.trim().slice(-500) || "Command failed.");
            });
          },
          deny: () => terminal.deny(run.id).then(() => undefined),
        });
        json(response, 202, { approval, run });
        return;
      }

      const userTerminalMatch = /^\/api\/sessions\/([^/]+)\/terminal-shell$/.exec(url.pathname);
      if (request.method === "POST" && userTerminalMatch?.[1]) {
        const session = await sessions.get(userTerminalMatch[1]);
        const absoluteCwd = await sessionWorkspace(session);
        const contentType = request.headers["content-type"] ?? "";
        const input = contentType.includes("json")
          ? await body(request).catch(() => ({}))
          : {};
        const force = Boolean((input as { force?: boolean }).force);
        const result = await ensureUserTerminalRun(session.id, absoluteCwd, { force });
        json(response, result.created ? 201 : 200, { run: result.run });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/browser/actions") {
        const input = parseBrowserActionRequest(await body(request));
        const session = await sessions.get(input.sessionId);
        // Navigation chrome is an exact, authenticated user gesture. Page actuation
        // (click/type) remains guarded because it may submit forms or cause side effects.
        if (["capture", "navigate", "reload", "back", "forward", "new-tab", "select-tab", "close-tab"].includes(input.action)) {
          json(response, 200, { browser: await browser.perform(input, { actor: "user" }) });
          return;
        }
        const approval = await approvals.request({
          sessionId: input.sessionId,
          projectId: session.projectId,
          capability: "browser",
          title: `Browser ${input.action}`,
          description: input.action === "type"
            ? "Type into the controlled, isolated browser profile. The text is kept in memory until you decide."
            : "Control the isolated browser and save a screenshot, visible text snapshot, console output, and action receipt.",
          scope: input.target ?? "active page",
          risk: input.action === "navigate" || input.action === "type" ? "high" : "medium",
          source: "browser",
          actor: "user",
          boundary: "controlled-browser",
        });
        await registerManualAction(approval, {
          approve: async () => {
            await approvals.mark(approval.id, "executing");
            void browser.perform(input, { actor: "user", approvalId: approval.id }).then(
              () => approvals.mark(approval.id, "completed"),
              (error) => approvals.mark(approval.id, "failed", error instanceof Error ? error.message : "Browser action failed."),
            );
          },
        });
        json(response, 202, { approval });
        return;
      }

      const approvalDecisionMatch = /^\/api\/approvals\/([^/]+)\/decision$/.exec(url.pathname);
      if (request.method === "POST" && approvalDecisionMatch?.[1]) {
        const input = parseApprovalDecisionRequest(await body(request));
        const approval = await approvals.decide(approvalDecisionMatch[1], input.decision, input.duration);
        const action = manualActions.get(approval.id);
        if (action) {
          manualActions.delete(approval.id);
          if (input.decision === "approve") await action.approve();
          else await action.deny?.();
        }
        json(response, 200, { approval: (await approvals.list(approval.sessionId)).find((item) => item.id === approval.id) });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/approval-rules") {
        json(response, 200, { rules: await approvals.listRules() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/approval-rules/audit") {
        const audit = await approvals.audit();
        const policyState = await teamPolicy.state();
        const exportedAudit = {
          ...audit,
          ...(policyState.policy ? { teamPolicy: policyState.policy } : {}),
        };
        response.writeHead(200, {
          "content-type": "application/vnd.vraxis.approval-policy-audit+json; charset=utf-8",
          "content-disposition": `attachment; filename="vraxis-code-approval-policy-${audit.generatedAt.slice(0, 10)}.json"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(`${JSON.stringify(exportedAudit)}\n`);
        return;
      }

      const approvalRuleMatch = /^\/api\/approval-rules\/([^/]+)$/.exec(url.pathname);
      if (request.method === "DELETE" && approvalRuleMatch?.[1]) {
        json(response, 200, { rule: await approvals.revokeRule(approvalRuleMatch[1]) });
        return;
      }

      const terminalInterruptMatch = /^\/api\/terminal\/([^/]+)\/interrupt$/.exec(url.pathname);
      if (request.method === "POST" && terminalInterruptMatch?.[1]) {
        await terminal.interrupt(terminalInterruptMatch[1]);
        json(response, 200, { status: "interrupted" });
        return;
      }

      const terminalStreamMatch = /^\/api\/terminal\/([^/]+)\/stream$/.exec(url.pathname);
      if (request.method === "GET" && terminalStreamMatch?.[1]) {
        const runId = terminalStreamMatch[1];
        const buffered: Parameters<Parameters<typeof terminal.subscribe>[1]>[0][] = [];
        let ready = false;
        let closed = false;
        const send = (event: Parameters<Parameters<typeof terminal.subscribe>[1]>[0]) => {
          if (closed) return;
          response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (event.type === "exit") {
            closed = true;
            response.end();
          }
        };
        const unsubscribe = terminal.subscribe(runId, (event) => {
          if (ready) send(event);
          else buffered.push(event);
        });
        try {
          const snapshot = await terminal.streamSnapshot(runId);
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            connection: "keep-alive",
            "x-accel-buffering": "no",
          });
          response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
          ready = true;
          if (!snapshot.active) {
            closed = true;
            response.end();
          } else {
            for (const event of buffered) {
              if (event.type !== "data" || event.sequence > snapshot.sequence) send(event);
            }
          }
        } catch (error) {
          unsubscribe();
          throw error;
        }
        request.once("close", () => {
          closed = true;
          unsubscribe();
        });
        return;
      }

      const terminalInputMatch = /^\/api\/terminal\/([^/]+)\/input$/.exec(url.pathname);
      if (request.method === "POST" && terminalInputMatch?.[1]) {
        const input = await body(request) as { data?: unknown };
        if (typeof input.data !== "string") throw new TypeError("Terminal input must be a string.");
        await terminal.input(terminalInputMatch[1], input.data);
        json(response, 200, { status: "written" });
        return;
      }

      const terminalResizeMatch = /^\/api\/terminal\/([^/]+)\/resize$/.exec(url.pathname);
      if (request.method === "POST" && terminalResizeMatch?.[1]) {
        const input = await body(request) as { columns?: unknown; rows?: unknown };
        json(response, 200, { run: await terminal.resize(terminalResizeMatch[1], Number(input.columns), Number(input.rows)) });
        return;
      }

      const browserScreenshotMatch = /^\/api\/browser\/([^/]+)\/screenshot$/.exec(url.pathname);
      if (request.method === "GET" && browserScreenshotMatch?.[1]) {
        const browserState = await browser.state(browserScreenshotMatch[1]);
        if (!browserState?.screenshotVersion) throw new TypeError("This browser session does not have a screenshot yet.");
        response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        createReadStream(browser.screenshotPath(browserScreenshotMatch[1])).pipe(response);
        return;
      }

      const browserFrameMatch = /^\/api\/browser\/([0-9a-f-]{36})\/frames\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (request.method === "GET" && browserFrameMatch?.[1] && browserFrameMatch[2]) {
        const browserState = await browser.state(browserFrameMatch[1]);
        if (!browserState?.frames?.some((item) => item.id === browserFrameMatch[2])) throw new TypeError("Browser frame was not found.");
        response.writeHead(200, { "content-type": "image/png", "cache-control": "private, max-age=31536000, immutable" });
        createReadStream(browser.framePath(browserFrameMatch[1], browserFrameMatch[2])).pipe(response);
        return;
      }

      if (options.publicDirectory && request.method === "GET") {
        const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const file = join(options.publicDirectory, requested);
        try {
          const fileStat = await stat(file);
          if (fileStat.isFile()) {
            response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream" });
            createReadStream(file).pipe(response);
            return;
          }
        } catch {
          // The single-page application fallback handles missing asset paths.
        }
        const index = join(options.publicDirectory, "index.html");
        response.writeHead(200, { "content-type": contentTypes[".html"] });
        response.end(await readFile(index));
        return;
      }

      json(response, 404, { error: "Route was not found." });
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) {
          try { response.end(); } catch { /* Response already closed. */ }
        }
        return;
      }
      const message = error instanceof Error ? error.message : "Request failed.";
      json(response, error instanceof TypeError ? 400 : 500, { error: message });
    }
  };
  return Object.assign(app, {
    close: async () => {
      await Promise.all([browser.close(), terminal.close()]);
    },
    warmupDiscovery: () => {
      runtimeDiscoveryCache.refreshInBackground();
    },
  });
}
