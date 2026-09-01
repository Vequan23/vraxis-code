import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import test from "node:test";
import { chromium, type BrowserContext } from "playwright";
import { MemoryCredentialStore, defineOutput, localExecutionScope, type ApprovalRequest, type CodingRuntimeRequest, type CodingRuntimeResult, type RuntimeReadiness } from "@vraxis/agent-v";
import { LocalCliRuntimeEngine } from "@vraxis/agent-v/local-cli";
import { executeAgentTool, type BrowserController } from "@vraxis/agent-v/tools";
import { ApprovalRegistry } from "../src/approvals/approval-registry.js";
import { BrowserWorkspace } from "../src/browser/browser-workspace.js";
import { commandArguments, executableCandidates, TerminalRegistry, terminatePty } from "../src/terminal/terminal-registry.js";
import { createAgentTerminalPollTool, createAgentTerminalTool } from "../src/terminal/agent-terminal-tool.js";
import { ModelProviderRegistry } from "../src/model-providers/model-provider-registry.js";
import { VraxisCodeRuntimeEngine } from "../src/runtimes/vraxis-code-runtime.js";
import { VerificationRegistry } from "../src/verification/verification-registry.js";

async function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

async function assertPrivateMode(path: string, expected: number): Promise<void> {
  const metadata = await stat(path);
  if (process.platform !== "win32") assert.equal(metadata.mode & 0o777, expected);
}

async function pendingApproval(approvals: ApprovalRegistry, sessionId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const [approval] = await approvals.list(sessionId);
    if (approval) return approval;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Approval was not persisted.");
}

test("persists a redacted agent approval and resumes the waiting policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-approval-test-"));
  const approvals = new ApprovalRegistry(root);
  const request: ApprovalRequest = {
    id: "agent-v-request",
    runId: "run-1",
    toolName: "browser-type",
    input: { target: "input[name=email]", text: "secret-value-is-not-persisted" },
    reason: "Allow the browser action.",
    category: "browser",
    risk: "external-side-effect",
    sideEffect: "non-idempotent",
    requiredPermissions: ["browser:control"],
    scope: {
      tenantId: "local",
      projectId: "project-1",
      principalId: "local-user",
      roles: ["owner"],
      permissions: ["*"],
      dataClassification: "confidential",
    },
  };
  const decision = approvals.policy("session-1").decide(request);
  let pending = await approvals.list("session-1");
  for (let attempt = 0; !pending.length && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    pending = await approvals.list("session-1");
  }
  assert.equal(pending[0]?.state, "pending");
  assert.equal(pending[0]?.scope, "input[name=email]");
  assert.doesNotMatch(JSON.stringify(pending), /secret-value-is-not-persisted/);
  await approvals.decide(pending[0]!.id, "approve");
  assert.equal(await decision, "approved");
});

test("remembers exact-scoped approval rules and supports revocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-approval-rule-test-"));
  const approvals = new ApprovalRegistry(root, undefined, async () => "full-access");
  const requested = await approvals.request({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "command",
    title: "Run tests",
    description: "Run the exact approved command.",
    scope: ". · npm test",
    risk: "high",
    source: "terminal",
  });
  await approvals.decide(requested.id, "approve", "project");
  const [rule] = await approvals.listRules("project-1", "session-2");
  assert.equal(rule?.effect, "allow");
  assert.equal(rule?.duration, "project");

  const remembered = await approvals.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "command",
    title: "Run tests",
    description: "Run the exact approved command.",
    scope: ". · npm test",
    risk: "high",
    source: "terminal",
  });
  assert.equal(remembered.state, "approved");
  assert.equal(remembered.matchedRuleId, rule?.id);

  const differentScope = await approvals.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "command",
    title: "Publish",
    description: "A different command must ask again.",
    scope: ". · npm publish",
    risk: "high",
    source: "terminal",
  });
  assert.equal(differentScope.state, "pending");

  await approvals.revokeRule(rule!.id);
  const audit = await approvals.audit();
  assert.deepEqual(audit.summary, { active: 0, revoked: 1, allowed: 0, denied: 0 });
  assert.equal(audit.rules[0]?.revokedAt !== undefined, true);
  const afterRevoke = await approvals.request({
    sessionId: "session-3",
    projectId: "project-1",
    capability: "command",
    title: "Run tests",
    description: "Revoked rules no longer apply.",
    scope: ". · npm test",
    risk: "high",
    source: "terminal",
  });
  assert.equal(afterRevoke.state, "pending");
});

test("redacts credentials and URL query values before approval scope persistence or export", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-approval-redaction-test-"));
  const approvals = new ApprovalRegistry(root, undefined, async () => "full-access");
  const requested = await approvals.request({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "network",
    title: "Call service",
    description: "Use a scoped endpoint.",
    scope: "https://user:password@example.com/review?token=sk-proj-abcdefghijklmnop#private",
    risk: "medium",
    source: "agent",
  });
  assert.equal(requested.scope, "https://example.com/review");
  await approvals.decide(requested.id, "approve", "project");
  const audit = await approvals.audit();
  assert.doesNotMatch(JSON.stringify(audit), /password|abcdefghijklmnop|private/);
});

test("remembered deny rules take precedence and rule listings stay project-scoped", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-approval-deny-test-"));
  const approvals = new ApprovalRegistry(root, undefined, async () => "full-access");
  const scope = ". · npm publish";
  const request = (sessionId: string, projectId: string) => ({
    sessionId,
    projectId,
    capability: "command" as const,
    title: "Publish",
    description: "Publish a package.",
    scope,
    risk: "high" as const,
    source: "terminal" as const,
  });

  const denied = await approvals.request(request("session-1", "project-1"));
  await approvals.decide(denied.id, "deny", "project");
  const allowed = await approvals.request(request("session-2", "project-1"), undefined, false);
  await approvals.decide(allowed.id, "approve", "project");
  const matched = await approvals.request(request("session-3", "project-1"));
  assert.equal(matched.state, "denied");

  const otherProject = await approvals.request(request("other-session", "project-2"));
  await approvals.decide(otherProject.id, "approve", "project");
  const projectRules = await approvals.listRules("project-1", "session-3");
  assert.equal(projectRules.length, 2);
  assert.ok(projectRules.every((rule) => rule.projectId === "project-1"));
});

test("fresh-only requests never match remembered destructive rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-approval-fresh-test-"));
  const approvals = new ApprovalRegistry(root);
  const first = await approvals.request({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "destructive",
    title: "Cleanup",
    description: "Remove a worktree.",
    scope: "/tmp/example",
    risk: "high",
    source: "worktree",
  });
  await assert.rejects(approvals.decide(first.id, "approve", "project"), /does not allow|fresh decision/);
  await approvals.decide(first.id, "approve");
  const fresh = await approvals.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "destructive",
    title: "Cleanup",
    description: "Remove a worktree.",
    scope: "/tmp/example",
    risk: "high",
    source: "worktree",
  }, undefined, false);
  assert.equal(fresh.state, "pending");
});

test("tokenizes and executes an approved command without a shell", async () => {
  assert.deepEqual(commandArguments("node -e \"console.log('ready')\""), ["node", "-e", "console.log('ready')"]);
  assert.deepEqual(
    commandArguments(String.raw`"C:\\Program Files\\nodejs\\node.exe" -e "console.log('ready')"`),
    ["C:\\Program Files\\nodejs\\node.exe", "-e", "console.log('ready')"],
  );
  assert.throws(() => commandArguments("node 'unfinished"), /unfinished quote/);
  const candidates = executableCandidates("npm", { PATH: "C:\\tools", PATHEXT: ".EXE;.CMD" }, "win32");
  assert.deepEqual(candidates.map((candidate) => extname(candidate).toLowerCase()), [".exe", ".cmd"]);
  const terminationSignals: Array<string | undefined> = [];
  const terminatedWindowsProcesses: number[] = [];
  const observedPty = { pid: 42, kill: (signal?: string) => { terminationSignals.push(signal); } };
  terminatePty(observedPty, "SIGTERM", "win32", (pid) => terminatedWindowsProcesses.push(pid));
  terminatePty(observedPty, "SIGTERM", "linux");
  assert.deepEqual(terminatedWindowsProcesses, [42]);
  assert.deepEqual(terminationSignals, ["SIGTERM"]);
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare("session-1", "approval-1", "node -e \"console.log('ready')\"", ".");
  const completed = await terminal.execute(run.id, root);
  assert.equal(completed.status, "success");
  assert.equal(completed.exitCode, 0);
  assert.match(completed.output, /ready/);
});

test("streams bounded terminal output while a command is still running", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-stream-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare("session-stream", "approval-stream", "node -e \"console.log('first'); setTimeout(() => console.log('second'), 350)\"", ".");
  const execution = terminal.execute(run.id, root);
  let live = (await terminal.list("session-stream"))[0]!;
  for (let attempt = 0; attempt < 30 && !live.output.includes("first"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    live = (await terminal.list("session-stream"))[0]!;
  }
  assert.equal(live.status, "running");
  assert.match(live.output, /first/);
  assert.ok(live.lastOutputAt);
  const completed = await execution;
  assert.equal(completed.status, "success");
  assert.match(completed.output, /first.*second/s);
});

test("publishes PTY output to live subscribers without waiting for retained-output persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-live-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare(
    "session-live",
    "approval-live",
    "node -e \"process.stdin.setEncoding('utf8'); process.stdin.once('data', value => { console.log(value.trim()); process.exit(0); })\"",
    ".",
  );
  const data = new Promise<{ sequence: number; data: string }>((resolve) => {
    const unsubscribe = terminal.subscribe(run.id, (event) => {
      if (event.type !== "data" || !event.data.includes("live-keystroke")) return;
      unsubscribe();
      resolve(event);
    });
  });
  const execution = terminal.execute(run.id, root);
  for (let attempt = 0; attempt < 40 && (await terminal.list("session-live"))[0]?.status !== "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await terminal.input(run.id, "live-keystroke\r");
  const streamed = await Promise.race([
    data,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Live terminal output timed out.")), 500)),
  ]);
  assert.ok(streamed.sequence > 0);
  assert.match(streamed.data, /live-keystroke/);
  const completed = await execution;
  assert.equal(completed.status, "success");
});

test("retains the beginning and end of oversized terminal output", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-truncation-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare(
    "session-truncation",
    "approval-truncation",
    "node -e \"process.stdout.write('HEAD-' + 'x'.repeat(1100000) + '-TAIL')\"",
    ".",
  );
  const completed = await terminal.execute(run.id, root);
  assert.equal(completed.status, "success");
  assert.equal(completed.outputTruncated, true);
  assert.match(completed.output, /^HEAD-/);
  assert.match(completed.output, /Output truncated; showing the first and last 512 KB/);
  assert.match(completed.output, /-TAIL$/);
  assert.ok(Buffer.byteLength(completed.output) < 1_050_000);
});

test("interrupts and retains active terminal work during graceful application shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-close-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare("session-close", "approval-close", "node -e \"setInterval(() => {}, 1000)\"", ".");
  const execution = terminal.execute(run.id, root);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await terminal.list("session-close"))[0]?.status === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await terminal.close();
  const completed = await execution;
  assert.equal(completed.status, "interrupted");
  assert.equal((await terminal.list("session-close"))[0]?.status, "interrupted");
});

test("accepts interactive PTY input and persists its replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-terminal-input-test-"));
  const terminal = new TerminalRegistry(root);
  const run = await terminal.prepare(
    "session-input",
    "approval-input",
    "node -e \"process.stdin.setEncoding('utf8'); process.stdin.once('data', value => { console.log('received:' + value.trim()); process.exit(0); })\"",
    ".",
  );
  const execution = terminal.execute(run.id, root);
  for (let attempt = 0; attempt < 40 && (await terminal.list("session-input"))[0]?.status !== "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await terminal.resize(run.id, 120, 36);
  await terminal.input(run.id, "hello PTY\r");
  const completed = await execution;
  assert.equal(completed.status, "success");
  assert.match(completed.output, /received:hello PTY/);
  assert.equal(completed.terminalKind, "pty");
  assert.equal(completed.columns, 120);
  assert.equal(completed.rows, 36);
  assert.ok((completed.outputVersion ?? 0) > 0);
});

test("an agent terminal command waits for approval and retains the exact terminal receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-terminal-test-"));
  const approvals = new ApprovalRegistry(root);
  const terminal = new TerminalRegistry(root);
  const tool = createAgentTerminalTool({ sessionId: "session-agent", workspacePath: root, terminal, approvals });
  const execution = executeAgentTool({
    tool,
    input: { command: "node -e \"console.log('agent-ready')\"", cwd: "." },
    runId: "run-agent",
    sessionId: "session-agent",
    scope: { ...localExecutionScope("project-agent"), permissions: ["command:execute"] },
    approvalPolicy: approvals.policy("session-agent"),
  });
  const pending = await pendingApproval(approvals, "session-agent");
  assert.equal(pending.id.length > 10, true);
  assert.equal(pending.capability, "command");
  assert.equal(pending.source, "agent");
  assert.match(pending.scope, /node -e/);
  assert.equal((await terminal.list("session-agent")).length, 0, "the command must not exist before approval");
  await approvals.decide(pending.id, "approve");
  const result = await execution as { runId: string; status: string; output: string };
  assert.equal(result.status, "success");
  assert.match(result.output, /agent-ready/);
  const [receipt] = await terminal.list("session-agent");
  assert.equal(receipt?.id, result.runId);
  assert.equal(receipt?.approvalId, pending.id);
  assert.equal(receipt?.status, "success");
  assert.equal((await approvals.list("session-agent"))[0]?.state, "completed");
});

test("an agent can start and poll a long-running command without blocking its trajectory", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-background-terminal-"));
  const approvals = new ApprovalRegistry(root);
  const terminal = new TerminalRegistry(root);
  const sessionId = "session-background";
  const execution = executeAgentTool({
    tool: createAgentTerminalTool({ sessionId, workspacePath: root, terminal, approvals }),
    input: { command: "node -e \"console.log('ready'); setTimeout(() => console.log('done'), 50)\"", background: true, timeoutMs: 5_000 },
    runId: "run-background",
    sessionId,
    scope: { ...localExecutionScope("project-background"), permissions: ["command:execute"] },
    approvalPolicy: approvals.policy(sessionId),
  });
  const pending = await pendingApproval(approvals, sessionId);
  await approvals.decide(pending.id, "approve");
  const started = await execution as { runId: string; status: string };
  assert.equal(started.status, "running");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const polled = await executeAgentTool({
    tool: createAgentTerminalPollTool({ sessionId, terminal }),
    input: { runId: started.runId },
    runId: "poll-background",
    sessionId,
    scope: { ...localExecutionScope("project-background"), permissions: ["command:execute"] },
  }) as { status: string; output: string; exitCode?: number };
  assert.equal(polled.status, "success");
  assert.equal(polled.exitCode, 0);
  assert.match(polled.output, /ready.*done/s);
});

test("a denied agent terminal command never creates a process receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-terminal-deny-"));
  const approvals = new ApprovalRegistry(root);
  const terminal = new TerminalRegistry(root);
  const execution = executeAgentTool({
    tool: createAgentTerminalTool({ sessionId: "session-deny", workspacePath: root, terminal, approvals }),
    input: { command: "node -e \"console.log('must-not-run')\"" },
    runId: "run-deny",
    sessionId: "session-deny",
    scope: { ...localExecutionScope("project-deny"), permissions: ["command:execute"] },
    approvalPolicy: approvals.policy("session-deny"),
  });
  const pending = await pendingApproval(approvals, "session-deny");
  await approvals.decide(pending.id, "deny");
  await assert.rejects(execution, /was denied/);
  assert.deepEqual(await terminal.list("session-deny"), []);
  assert.equal((await approvals.list("session-deny"))[0]?.state, "denied");
});

test("cancelling while terminal approval is pending interrupts the approval and runs nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-terminal-cancel-"));
  const approvals = new ApprovalRegistry(root);
  const terminal = new TerminalRegistry(root);
  const controller = new AbortController();
  const execution = executeAgentTool({
    tool: createAgentTerminalTool({ sessionId: "session-cancel", workspacePath: root, terminal, approvals }),
    input: { command: "node -e \"console.log('must-not-run')\"" },
    runId: "run-cancel",
    sessionId: "session-cancel",
    scope: { ...localExecutionScope("project-cancel"), permissions: ["command:execute"] },
    approvalPolicy: approvals.policy("session-cancel"),
    abortSignal: controller.signal,
  });
  await pendingApproval(approvals, "session-cancel");
  controller.abort();
  await assert.rejects(execution, /cancelled while awaiting approval/);
  assert.deepEqual(await terminal.list("session-cancel"), []);
  const [approval] = await approvals.list("session-cancel");
  assert.equal(approval?.state, "interrupted");
  assert.match(approval?.failure ?? "", /cancelled/);
});

test("a cancelled approval cannot be stranded while governance delays persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-terminal-early-cancel-"));
  let reportGovernanceStarted!: () => void;
  let releaseGovernance!: () => void;
  const governanceStarted = new Promise<void>((resolve) => { reportGovernanceStarted = resolve; });
  const governanceReleased = new Promise<void>((resolve) => { releaseGovernance = resolve; });
  const approvals = new ApprovalRegistry(root, async () => {
    reportGovernanceStarted();
    await governanceReleased;
    return { forceFresh: false };
  });
  const terminal = new TerminalRegistry(root);
  const controller = new AbortController();
  const execution = executeAgentTool({
    tool: createAgentTerminalTool({ sessionId: "session-early-cancel", workspacePath: root, terminal, approvals }),
    input: { command: "node -e \"console.log('must-not-run')\"" },
    runId: "run-early-cancel",
    sessionId: "session-early-cancel",
    scope: { ...localExecutionScope("project-early-cancel"), permissions: ["command:execute"] },
    approvalPolicy: approvals.policy("session-early-cancel"),
    abortSignal: controller.signal,
  });
  await governanceStarted;
  controller.abort();
  await assert.rejects(execution, /cancelled while awaiting approval/);
  releaseGovernance();
  const approval = await pendingApproval(approvals, "session-early-cancel");
  assert.equal(approval.state, "interrupted");
  assert.deepEqual(await terminal.list("session-early-cancel"), []);
});

test("local Build harnesses receive governed file and terminal tools with native command bypass removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-local-tools-test-"));
  class CapturingLocalRuntime extends LocalCliRuntimeEngine {
    captured?: CodingRuntimeRequest<unknown>;
    override async inspect(runtimeId: string): Promise<RuntimeReadiness> {
      const versions: Record<string, string> = {
        codex: "codex-cli 0.151.0",
        "claude-code": "2.1.251",
        opencode: "1.2.0",
        cursor: "2026.08.25",
      };
      return { runtimeId, availability: "installed", verification: "ready", version: versions[runtimeId] ?? "1.0.0", detail: "Ready for adapter contract testing." };
    }
    override async run<T>(request: CodingRuntimeRequest<T>): Promise<CodingRuntimeResult<T>> {
      this.captured = request as CodingRuntimeRequest<unknown>;
      return {
        runId: request.runId ?? "run-local",
        output: request.output.parse({ ok: true }),
        provenance: { engineId: "capture", adapterStrategy: "capture", runtime: request.runtimeId },
        durationMs: 1,
        runtimeId: request.runtimeId,
        activityCount: 0,
        attempts: 1,
      };
    }
  }
  const credentials = new MemoryCredentialStore();
  const approvals = new ApprovalRegistry(root);
  const terminal = new TerminalRegistry(root);
  const browser = new BrowserWorkspace(root);
  const verifications = new VerificationRegistry(root);
  const local = new CapturingLocalRuntime();
  const engine = new VraxisCodeRuntimeEngine(new ModelProviderRegistry(root, credentials), credentials, approvals, browser, terminal, verifications, local);
  const output = defineOutput({ name: "ok", jsonSchema: { type: "object" }, parse: () => ({ ok: true }) });
  for (const runtimeId of ["codex", "claude-code", "opencode", "cursor"]) {
    await engine.run({
      runtimeId,
      workspacePath: root,
      workspaceAccess: "workspace-write",
      sessionId: `session-${runtimeId}`,
      metadata: { mode: "build" },
      scope: localExecutionScope("project-local"),
      input: { prompt: "Build it." },
      output,
    });
    const names = local.captured?.tools?.map((tool) => tool.name) ?? [];
    assert.ok(names.includes("terminal-run"), `${runtimeId} must receive the governed terminal`);
    assert.ok(names.includes("terminal-poll"), `${runtimeId} must receive background terminal polling`);
    assert.ok(names.includes("terminal-stop"), `${runtimeId} must receive background terminal cancellation`);
    assert.ok(names.includes("evidence-status"), `${runtimeId} must receive task evidence`);
    assert.ok(names.includes("request-verification"), `${runtimeId} must receive the product-owned verification handoff`);
    assert.ok(names.includes("browser-navigate"), `${runtimeId} must receive governed browser navigation`);
    assert.ok(names.includes("browser-network"), `${runtimeId} must receive browser evidence`);
    assert.ok(names.includes("browser-screenshot"), `${runtimeId} must receive screenshot evidence`);
    assert.ok(names.includes("browser-wait"), `${runtimeId} must receive bounded browser waits`);
    assert.ok(names.includes("create-text"), `${runtimeId} must receive governed file creation`);
    assert.ok(names.includes("apply-workspace-patch"), `${runtimeId} must receive governed patch application`);
    assert.equal(names.includes("run-command"), false, `${runtimeId} must not receive the native command bypass`);
    assert.ok(local.captured?.approvalPolicy, `${runtimeId} must receive the product approval policy`);
  }

  await engine.run({
    runtimeId: "cursor",
    workspacePath: root,
    workspaceAccess: "read-only",
    sessionId: "session-cursor-read",
    metadata: { mode: "ask" },
    scope: localExecutionScope("project-local"),
    input: { prompt: "Explain it." },
    output,
  });
  const cursorNames = local.captured?.tools?.map((tool) => tool.name) ?? [];
  assert.ok(cursorNames.includes("read-text"));
  assert.equal(cursorNames.includes("create-text"), false);
  assert.equal(cursorNames.includes("terminal-run"), false);
  assert.ok(cursorNames.includes("browser-snapshot"));
  assert.ok(cursorNames.includes("browser-navigate"));
  assert.ok(cursorNames.includes("browser-click"));
  assert.ok(cursorNames.includes("browser-type"));
  assert.ok(cursorNames.includes("evidence-status"));
  assert.ok(cursorNames.includes("request-verification"));
  assert.ok(local.captured?.approvalPolicy);
});

test("agent browser controls advance approved receipts through execution to completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-receipt-test-"));
  class CapturingLocalRuntime extends LocalCliRuntimeEngine {
    captured?: CodingRuntimeRequest<unknown>;
    override async inspect(runtimeId: string): Promise<RuntimeReadiness> {
      return { runtimeId, availability: "installed", verification: "ready", version: "codex-cli 1.0.0", detail: "Ready." };
    }
    override async run<T>(request: CodingRuntimeRequest<T>): Promise<CodingRuntimeResult<T>> {
      this.captured = request as CodingRuntimeRequest<unknown>;
      return { runId: "run", output: request.output.parse({ ok: true }), provenance: { engineId: "capture", adapterStrategy: "capture", runtime: request.runtimeId }, durationMs: 1, runtimeId: request.runtimeId, activityCount: 0, attempts: 1 };
    }
  }
  const credentials = new MemoryCredentialStore();
  const approvals = new ApprovalRegistry(root);
  const local = new CapturingLocalRuntime();
  const controlled: BrowserController = {
    currentUrl: async () => "http://127.0.0.1:4318/",
    snapshot: async () => ({ title: "Vraxis Code" }),
    navigate: async (url) => ({ url }),
    click: async (target) => ({ target }),
    type: async (target, value) => ({ target, value }),
  };
  const browser = {
    allowedOrigins: async () => [],
    controller: () => controlled,
  } as unknown as BrowserWorkspace;
  const engine = new VraxisCodeRuntimeEngine(new ModelProviderRegistry(root, credentials), credentials, approvals, browser, undefined, undefined, local);
  const output = defineOutput({ name: "ok", jsonSchema: { type: "object" }, parse: () => ({ ok: true }) });
  await engine.run({ runtimeId: "codex", workspacePath: root, workspaceAccess: "read-only", sessionId: "session-browser-receipt", metadata: { mode: "ask" }, scope: localExecutionScope("project-browser-receipt"), input: { prompt: "Open it." }, output });
  const navigate = local.captured?.tools?.find((tool) => tool.name === "browser-navigate");
  assert.ok(navigate);
  const approval = await approvals.request({ sessionId: "session-browser-receipt", projectId: "project-browser-receipt", capability: "browser", title: "Browser Navigate", description: "Navigate the controlled browser.", scope: "http://127.0.0.1:4318", risk: "medium", source: "agent" });
  await approvals.decide(approval.id, "approve");
  await navigate.execute({ url: "http://127.0.0.1:4318" }, { runId: "run", sessionId: "session-browser-receipt", scope: localExecutionScope("project-browser-receipt"), toolCallId: "call", approvalId: approval.id, artifacts: [] });
  assert.equal((await approvals.list("session-browser-receipt"))[0]?.state, "completed");
});

test("controls an isolated browser and captures visible evidence", async (context) => {
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/evidence")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Evidence page</title><input name='message'><button onclick=\"document.body.dataset.clicked='yes'\">Save</button><script>fetch('/evidence?token=browser-secret')</script>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser fixture did not start.");
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-test-"));
  const browser = new BrowserWorkspace(root);
  context.after(async () => {
    await browser.close();
    await closeHttpServer(server);
  });
  const url = `http://127.0.0.1:${address.port}/`;
  const navigated = await browser.perform({ sessionId: "session-1", action: "navigate", target: url });
  assert.equal(navigated.title, "Evidence page");
  assert.ok(navigated.allowedOrigins.includes(`http://127.0.0.1:${address.port}`));
  assert.equal(navigated.tabs.length, 1);
  assert.equal(navigated.canGoBack, false);
  assert.equal(navigated.canGoForward, false);
  const secondPage = await browser.perform({ sessionId: "session-1", action: "navigate", target: `${url}second` });
  assert.equal(secondPage.canGoBack, true);
  const wentBack = await browser.perform({ sessionId: "session-1", action: "back" });
  assert.equal(wentBack.url, url);
  assert.equal(wentBack.canGoForward, true);
  const wentForward = await browser.perform({ sessionId: "session-1", action: "forward" });
  assert.equal(wentForward.url, `${url}second`);
  Object.assign(navigated, await browser.perform({ sessionId: "session-1", action: "back" }));
  const simultaneousCaptures = await Promise.all([
    browser.perform({ sessionId: "session-1", action: "capture" }),
    browser.perform({ sessionId: "session-1", action: "capture" }),
  ]);
  assert.ok(simultaneousCaptures[1]!.actions.filter((action) => action.action === "capture").length >= 2);
  for (let attempt = 0; attempt < 20 && !navigated.network.some((entry) => entry.url.includes("/evidence")); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    Object.assign(navigated, await browser.perform({ sessionId: "session-1", action: "capture" }));
  }
  assert.ok(navigated.network.some((entry) => entry.url.includes("/evidence")));
  assert.doesNotMatch(JSON.stringify(navigated.network), /browser-secret/);
  const messageControl = navigated.controls.find((control) => control.kind === "textbox");
  const saveControl = navigated.controls.find((control) => control.label === "Save");
  assert.ok(messageControl);
  assert.ok(saveControl);
  assert.ok(saveControl.bounds.width > 0);
  await browser.perform({ sessionId: "session-1", action: "type", target: messageControl.ref, value: "hello" });
  const clicked = await browser.perform({ sessionId: "session-1", action: "click", target: saveControl.ref });
  assert.match(clicked.snapshot, /Save/);
  assert.ok(clicked.screenshotVersion >= 3);
  const clickReceipt = clicked.actions.find((action) => action.action === "click");
  assert.ok(clickReceipt?.beforeFrameId);
  assert.ok(clickReceipt?.afterFrameId);
  assert.ok(clicked.frames?.some((frame) => frame.id === clickReceipt.beforeFrameId && frame.phase === "before"));
  assert.ok(clicked.frames?.some((frame) => frame.id === clickReceipt.afterFrameId && frame.phase === "after"));
  assert.equal((await stat(browser.framePath("session-1", clickReceipt.afterFrameId!))).isFile(), true);
  const secondTab = await browser.perform({ sessionId: "session-1", action: "new-tab" });
  assert.equal(secondTab.tabs.length, 2);
  assert.equal(secondTab.url, "");
  const originalTab = secondTab.tabs.find((tab) => tab.url === url);
  assert.ok(originalTab);
  const selected = await browser.perform({ sessionId: "session-1", action: "select-tab", tabId: originalTab.id });
  assert.equal(selected.url, url);
  const blankTab = selected.tabs.find((tab) => !tab.url);
  assert.ok(blankTab);
  const closed = await browser.perform({ sessionId: "session-1", action: "close-tab", tabId: blankTab.id });
  assert.equal(closed.tabs.length, 1);
  const artifact = await browser.contextArtifact("session-1");
  assert.equal(artifact?.uri, url);
  assert.match(artifact?.content ?? "", /Visible page text/);
  assert.match(artifact?.content ?? "", /Interactive controls/);
  assert.match(artifact?.content ?? "", /e\d+ \[button\] Save/);
});

test("persists browser evidence and encrypted authentication state across a service restart", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Durable browser proof</title><main><h1 id="state">Recovered evidence</h1><button>Verify</button></main><script>
      const restored = document.cookie.includes("vraxis_session=private-cookie") && localStorage.getItem("vraxis-token") === "private-local-storage";
      document.querySelector("#state").textContent = restored ? "Recovered private state" : "Recovered evidence";
      document.cookie = "vraxis_session=private-cookie; SameSite=Strict";
      localStorage.setItem("vraxis-token", "private-local-storage");
    </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser fixture did not start.");
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-restart-test-"));
  const credentials = new MemoryCredentialStore();
  const first = new BrowserWorkspace(root, credentials);
  const second = new BrowserWorkspace(root, credentials);
  context.after(async () => {
    await first.close();
    await second.close();
    await closeHttpServer(server);
  });
  const sessionId = "session-durable";
  const url = `http://127.0.0.1:${address.port}/`;
  const captured = await first.perform(
    { sessionId, action: "navigate", target: url },
    { actor: "agent", approvalId: "approval-durable" },
  );
  assert.equal(captured.status, "ready");
  assert.equal(captured.title, "Durable browser proof");
  assert.match(captured.snapshot, /Recovered evidence/);
  assert.ok(captured.controls.some((control) => control.label === "Verify"));
  assert.ok(captured.actions.some((action) => action.approvalId === "approval-durable"));
  const capturedVersion = captured.screenshotVersion;
  await first.close();

  const registryFile = join(root, "browser-evidence.json");
  const registry = JSON.parse(await readFile(registryFile, "utf8")) as { schemaVersion: number; sessions: Array<{ sessionId: string }> };
  assert.equal(registry.schemaVersion, 1);
  assert.ok(registry.sessions.some((item) => item.sessionId === sessionId));
  await assertPrivateMode(registryFile, 0o600);
  const encryptedState = await readFile(join(root, "browser-state", `${sessionId}.json`), "utf8");
  assert.doesNotMatch(encryptedState, /private-cookie|private-local-storage/);

  const retained = await second.state(sessionId);
  assert.equal(retained?.status, "closed");
  assert.equal(retained?.url, url);
  assert.equal(retained?.title, "Durable browser proof");
  assert.match(retained?.snapshot ?? "", /Recovered evidence/);
  assert.equal(retained?.screenshotVersion, capturedVersion);
  assert.ok(retained?.allowedOrigins.includes(`http://127.0.0.1:${address.port}`));
  assert.ok(retained?.actions.some((action) => action.approvalId === "approval-durable"));
  assert.equal((await stat(second.screenshotPath(sessionId))).isFile(), true);

  const artifact = await second.contextArtifact(sessionId);
  assert.match(artifact?.title ?? "", /Retained browser context/);
  assert.match(artifact?.content ?? "", /refresh before acting/);
  assert.equal(artifact?.metadata.retained, true);

  const restored = await second.perform({ sessionId, action: "capture" }, { actor: "user", approvalId: "approval-restore" });
  assert.equal(restored.status, "ready");
  assert.equal(restored.url, url);
  assert.match(restored.snapshot, /Recovered private state/);
  assert.ok(restored.screenshotVersion > capturedVersion);
  assert.ok(restored.actions.some((action) => action.approvalId === "approval-restore"));
});

test("migrates a legacy isolated profile into encrypted state without discarding the source profile", async (context) => {
  const externalRequests: string[] = [];
  const server = createServer((request, response) => {
    externalRequests.push(request.url ?? "");
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Legacy migration</title><h1 id="state">Fresh</h1><script>
      if (document.cookie.includes("legacy_session=private-cookie") && localStorage.getItem("legacy-token") === "private-storage") {
        document.querySelector("#state").textContent = "Legacy state restored";
      }
    </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser fixture did not start.");
  const root = await mkdtemp(join(tmpdir(), "vraxis-browser-migration-test-"));
  const sessionId = "session-legacy";
  const profilePath = join(root, "browser-profiles", sessionId);
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = new BrowserWorkspace(root, new MemoryCredentialStore());
  let legacy: BrowserContext | undefined;
  context.after(async () => {
    await legacy?.close().catch(() => undefined);
    await browser.close();
    await closeHttpServer(server);
  });
  try {
    legacy = await chromium.launchPersistentContext(profilePath, { headless: true });
  } catch {
    legacy = await chromium.launchPersistentContext(profilePath, { headless: true, channel: "chrome" });
  }
  const legacyPage = legacy.pages()[0] ?? await legacy.newPage();
  await legacyPage.goto(url);
  await legacyPage.evaluate(() => {
    document.cookie = "legacy_session=private-cookie; Max-Age=3600; SameSite=Strict";
    localStorage.setItem("legacy-token", "private-storage");
  });
  await legacy.close();

  await writeFile(join(root, "browser-evidence.json"), `${JSON.stringify({
    schemaVersion: 1,
    sessions: [{
      sessionId,
      status: "closed",
      url,
      title: "Legacy migration",
      snapshot: "Legacy retained evidence",
      screenshotVersion: 1,
      viewport: { width: 1280, height: 820 },
      activeTabId: "legacy-tab",
      tabs: [],
      controls: [],
      allowedOrigins: [new URL(url).origin],
      console: [],
      network: [],
      actions: [],
      frames: [],
      updatedAt: new Date().toISOString(),
    }],
  }, null, 2)}\n`);

  const migrated = await browser.perform({ sessionId, action: "navigate", target: url });
  assert.match(migrated.snapshot, /Legacy state restored/);
  assert.equal(externalRequests.filter((requestUrl) => requestUrl === "/").length, 2, "migration must hydrate origin storage without requesting the retained document");
  const encrypted = await readFile(join(root, "browser-state", `${sessionId}.json`), "utf8");
  assert.doesNotMatch(encrypted, /private-cookie|private-storage/);
  assert.equal((await stat(join(root, "browser-profiles", `${sessionId}.migrated`))).isDirectory(), true);
});

test("agent browser navigation requests the first origin through approval and accepts only mapped controls", async (context) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Agent browser</title><button>Continue</button>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Browser fixture did not start.");
  const root = await mkdtemp(join(tmpdir(), "vraxis-agent-browser-test-"));
  const browser = new BrowserWorkspace(root);
  context.after(async () => {
    await browser.close();
    await closeHttpServer(server);
  });
  const controller = browser.controller("session-agent-browser");
  const url = `http://127.0.0.1:${address.port}/`;
  await assert.rejects(controller.navigate(url), /has not been approved/);
  const result = await controller.navigate(url, { approvalId: "approval-browser-origin" });
  assert.equal(result.url, url);
  const state = await browser.state("session-agent-browser");
  assert.equal(state?.actions[0]?.actor, "agent");
  assert.equal(state?.actions[0]?.approvalId, "approval-browser-origin");
  await assert.rejects(controller.click("button", { approvalId: "approval-browser-click" }), /numbered browser control/);
});
