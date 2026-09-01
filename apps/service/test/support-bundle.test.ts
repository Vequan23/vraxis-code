import assert from "node:assert/strict";
import test from "node:test";
import { createSupportBundle } from "../src/diagnostics/support-bundle.js";

test("creates useful recovery diagnostics without project content or credentials", () => {
  const bundle = createSupportBundle({
    applicationVersion: "0.1.0",
    contractVersion: 26,
    desktopSessionProtected: true,
    projects: [{ id: "project-secret", name: "private-customer", path: "/Users/customer/secret", branch: "main", status: "ready" }],
    sessions: [{ id: "session-secret", projectId: "project-secret", title: "Fix API_KEY=secret-value", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "interrupted", worktree: { id: "worktree-secret", path: "/tmp/secret", branch: "vraxis/secret", baseBranch: "main", baseCommit: "abc", status: "conflicted" } }],
    runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "/secret/path", acceptsCustomModel: true, models: [], version: "1.2.3", authentication: "authenticated" }],
    approvals: [{ id: "approval-secret", sessionId: "session-secret", projectId: "project-secret", capability: "command", title: "Run secret", description: "token=secret-value", scope: "secret command", risk: "high", source: "terminal", requestedAt: new Date().toISOString(), state: "interrupted" }],
    terminalRuns: [{ id: "terminal-secret", sessionId: "session-secret", approvalId: "approval-secret", command: "echo secret-value", cwd: ".", status: "interrupted", output: "secret-value", terminalKind: "pty" }],
    verificationRuns: [{ id: "verify-secret", sessionId: "session-secret", projectId: "project-secret", projectName: "private-customer", state: "interrupted", changedPaths: ["secret.ts"], services: [], checks: [], browserAssertions: [], browserRecommended: false, browserState: "not-required", recipeFingerprint: "a".repeat(64), createdAt: new Date().toISOString() }],
    startupRecovery: { previousUnexpectedExit: true, previousStartedAt: "2026-08-31T09:59:00.000Z", checkedAt: "2026-08-31T10:00:00.000Z" },
  });
  assert.equal(bundle.recovery.worktreesNeedingReview, 1);
  assert.equal(bundle.recovery.previousUnexpectedExit, true);
  assert.equal(bundle.recovery.approvalsInterrupted, 1);
  assert.equal(bundle.inventory.runtimes[0]?.version, "1.2.3");
  const exported = JSON.stringify(bundle);
  for (const secret of ["private-customer", "/Users/customer/secret", "secret-value", "secret.ts", "secret command"]) {
    assert.equal(exported.includes(secret), false);
  }
  assert.equal(bundle.security.includesProjectContent, false);
  assert.equal(bundle.security.includesCredentials, false);
});
