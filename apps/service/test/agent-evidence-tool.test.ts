import assert from "node:assert/strict";
import test from "node:test";
import { executeAgentTool } from "@vraxis/agent-v/tools";
import { localExecutionScope } from "@vraxis/agent-v";
import type { ApprovalSummary, TerminalRunSummary, VerificationHandoffSummary, VerificationRunSummary } from "@vraxis/code-contracts";
import { createAgentEvidenceTool } from "../src/sessions/agent-evidence-tool.js";

test("exposes cross-harness evidence status without raw task content or credentials", async () => {
  const secret = "sk-proj-this-must-never-cross-the-evidence-tool";
  const approvals: ApprovalSummary[] = [{
    id: "approval-1",
    sessionId: "session-1",
    projectId: "project-1",
    requestedAt: "2026-08-31T10:00:00.000Z",
    capability: "command",
    title: `Publish with ${secret}`,
    description: "Sensitive approval description",
    scope: `. · node release.js --token=${secret}`,
    risk: "high",
    state: "completed",
    source: "terminal",
  }];
  const terminalRuns: TerminalRunSummary[] = [{
    id: "terminal-1",
    sessionId: "session-1",
    approvalId: "approval-1",
    command: `node release.js --token=${secret}`,
    cwd: ".",
    status: "success",
    output: `authenticated with ${secret}`,
    exitCode: 0,
    durationMs: 420,
  }];
  const verificationRuns: VerificationRunSummary[] = [{
    id: "verification-1",
    sessionId: "session-1",
    projectId: "project-1",
    projectName: `secret-project-${secret}`,
    state: "failed",
    changedPaths: [`private/${secret}.ts`],
    services: [],
    checks: [{
      id: "test",
      title: `Secret check ${secret}`,
      category: "test",
      command: "node",
      args: ["test.js", secret],
      cwd: ".",
      required: true,
      timeoutMs: 1_000,
      source: "project",
      state: "failed",
      failure: `failed with ${secret}`,
    }],
    browserAssertions: [],
    browserRecommended: false,
    browserState: "not-required",
    recipeFingerprint: "sha256:safe",
    createdAt: "2026-08-31T10:00:00.000Z",
  }];
  const verificationHandoffs: VerificationHandoffSummary[] = [{
    id: "handoff-1",
    sessionId: "session-1",
    state: "requested",
    requestedAt: "2026-08-31T10:00:00.000Z",
    requestedBy: { actor: "agent", runtimeId: "codex" },
    note: `Never expose this handoff note ${secret}`,
  }];
  const tool = createAgentEvidenceTool({
    sessionId: "session-1",
    approvals: { async list() { return approvals; } },
    terminal: { async list() { return terminalRuns; } },
    verifications: {
      async list() { return verificationRuns; },
      async listHandoffs() { return verificationHandoffs; },
    },
  });

  const result = await executeAgentTool({
    tool,
    input: {},
    runId: "run-1",
    sessionId: "session-1",
    scope: localExecutionScope("project-1"),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, /release\.js|authenticated|secret-project|private\//);
  assert.match(serialized, /verification-1/);
  assert.match(serialized, /"failedCheckCount":1/);
  assert.match(serialized, /"pendingVerificationHandoffCount":1/);
  assert.match(serialized, /handoff-1/);
  assert.match(serialized, /"status":"success"/);
  assert.match(serialized, /"worktree":null/);
});

test("includes host-managed worktree summary without filesystem paths", async () => {
  const tool = createAgentEvidenceTool({
    sessionId: "session-1",
    approvals: { async list() { return []; } },
    terminal: { async list() { return []; } },
    verifications: { async list() { return []; } },
    worktree: {
      id: "wt-1",
      path: "/secret/worktree/path",
      branch: "vraxis/task-abc12345",
      baseBranch: "main",
      baseCommit: "deadbeef12345678",
      status: "active",
    },
  });

  const result = await executeAgentTool({
    tool,
    input: {},
    runId: "run-1",
    sessionId: "session-1",
    scope: localExecutionScope("project-1"),
  });
  const serialized = JSON.stringify(result);
  assert.match(serialized, /vraxis\/task-abc12345/);
  assert.match(serialized, /"hostManaged":true/);
  assert.doesNotMatch(serialized, /secret\/worktree/);
});
