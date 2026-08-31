import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskReceiptV1, UnderstandArtifactEnvelopeV1 } from "@vraxis/code-contracts";
import { TaskProofSigner } from "../src/receipts/task-proof.js";
import {
  createUnderstandArtifact,
  understandPayload,
  verifyUnderstandArtifact,
} from "../src/receipts/understand-artifact.js";

const secret = "sk-do-not-export-123";

function receipt(): TaskReceiptV1 {
  return {
    kind: "vraxis.task-receipt",
    version: 1,
    generatedAt: "2026-08-31T12:00:00.000Z",
    session: { id: "session-1", title: "Improve checkout", mode: "build", status: "idle", runtimeId: "codex", updatedAt: "2026-08-31T12:00:00.000Z" },
    project: { id: "project-1", name: "sample", branch: "main" },
    worktree: { id: "worktree-1", path: "/private/worktree", branch: "feature/checkout", baseBranch: "main", baseCommit: "a".repeat(40), status: "active" },
    changes: [
      { path: "src/checkout.ts", status: "modified" },
      { path: "src/uncovered.ts", status: "added" },
    ],
    approvals: [{ id: "approval-1", sessionId: "session-1", projectId: "project-1", requestedAt: "2026-08-31T11:58:00.000Z", capability: "command", title: secret, description: secret, scope: secret, risk: "high", state: "completed", source: "terminal" }],
    terminalRuns: [{ id: "terminal-1", sessionId: "session-1", approvalId: "approval-1", command: `test --token=${secret}`, cwd: ".", status: "success", output: secret }],
    verificationRuns: [{
      id: "verification-1", sessionId: "session-1", projectId: "project-1", projectName: "sample", state: "passed", changedPaths: ["src/checkout.ts"], services: [],
      checks: [{ id: "check", title: "Project check", category: "check", command: "npm", args: ["run", "check"], cwd: ".", required: true, timeoutMs: 60_000, source: "project", state: "passed" }],
      browserAssertions: [], browserRecommended: false, browserState: "not-required", recipeFingerprint: "b".repeat(64), createdAt: "2026-08-31T11:59:00.000Z", completedAt: "2026-08-31T12:00:00.000Z",
    }],
    browser: {
      url: `https://example.test/?token=${secret}`, title: secret, viewport: { width: 1280, height: 720 },
      actions: [{ id: "browser-1", action: "click", target: secret, status: "success", timestamp: "2026-08-31T12:00:00.000Z", detail: secret }],
      console: [{ id: "console-1", timestamp: "2026-08-31T12:00:00.000Z", level: "info", text: secret }],
      network: [{ id: "network-1", timestamp: "2026-08-31T12:00:00.000Z", method: "GET", url: `https://example.test/${secret}`, resourceType: "fetch", state: "success", status: 200 }],
    },
    activity: [{ id: "event-1", sessionId: "session-1", sequence: 1, timestamp: "2026-08-31T12:00:00.000Z", runtimeId: "codex", kind: "message", title: secret, detail: secret, state: "complete" }],
  };
}

test("creates a deterministic, grounded, secret-minimized signed understanding artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-understand-"));
  const signer = new TaskProofSigner(root);
  const proof = await signer.create(receipt());
  const firstPayload = understandPayload(proof);
  const secondPayload = understandPayload(proof);
  const artifact = await createUnderstandArtifact(proof, signer);

  assert.deepEqual(firstPayload, secondPayload);
  assert.equal(artifact.verdict.state, "partially-verified");
  assert.deepEqual(artifact.changes.map((change) => [change.path, change.coverage]), [
    ["src/checkout.ts", "verified"],
    ["src/uncovered.ts", "unverified"],
  ]);
  assert.equal(artifact.risks.some((risk) => risk.id === "risk-coverage"), true);
  assert.equal(artifact.rollback?.baseCommit, "a".repeat(40));
  assert.equal(artifact.teachBack.length >= 3, true);
  assert.equal(verifyUnderstandArtifact(artifact), true);
  assert.doesNotMatch(JSON.stringify(artifact), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(artifact), /PRIVATE KEY/);
});

test("reports retained failures and rejects tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-understand-tamper-"));
  const signer = new TaskProofSigner(root);
  const failed = receipt();
  failed.terminalRuns[0]!.status = "error";
  const artifact = await createUnderstandArtifact(await signer.create(failed), signer);
  assert.equal(artifact.verdict.state, "needs-review");
  assert.equal(artifact.risks.some((risk) => risk.id === "risk-terminal" && risk.severity === "critical"), true);

  const tampered = structuredClone(artifact) as UnderstandArtifactEnvelopeV1;
  tampered.verdict.summary = "Everything is definitely safe.";
  assert.equal(verifyUnderstandArtifact(tampered), false);
});
