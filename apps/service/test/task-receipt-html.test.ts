import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskReceiptV1 } from "@vraxis/code-contracts";
import { TaskProofSigner } from "../src/receipts/task-proof.js";
import { renderTaskReceiptHtml } from "../src/receipts/task-receipt-html.js";

test("renders a deep-linked offline human proof without allowing receipt content to become markup", async () => {
  const receipt: TaskReceiptV1 = {
    kind: "vraxis.task-receipt",
    version: 1,
    generatedAt: "2026-08-31T12:00:00.000Z",
    session: {
      id: "session-proof",
      title: "Fix <script>alert('receipt')</script>",
      mode: "build",
      status: "idle",
      runtimeId: "codex",
      updatedAt: "2026-08-31T12:00:00.000Z",
    },
    project: { id: "project-proof", name: "sample&project", branch: "main" },
    changes: [{ path: "src/<unsafe>.ts", status: "modified" }],
    approvals: [],
    terminalRuns: [{
      id: "terminal-proof",
      sessionId: "session-proof",
      approvalId: "approval-proof",
      command: "node check.js --token sk-proj-supersecretvalue1234",
      cwd: ".",
      status: "success",
      output: "API_KEY=sk-proj-anothersecretvalue1234\npassed\n",
    }],
    verificationRuns: [{
      id: "verification-proof",
      sessionId: "session-proof",
      projectId: "project-proof",
      projectName: "sample&project",
      state: "passed",
      changedPaths: ["src/<unsafe>.ts"],
      checks: [{ id: "check", title: "Project check", category: "check", command: "npm", args: ["run", "check"], cwd: ".", required: true, timeoutMs: 1_000, source: "package.json", state: "passed" }],
      browserRecommended: false,
      browserState: "not-required",
      recipeFingerprint: "a".repeat(64),
      createdAt: "2026-08-31T12:00:00.000Z",
    }],
    activity: [],
  };

  const proof = await new TaskProofSigner(await mkdtemp(join(tmpdir(), "vraxis-task-proof-html-"))).create(receipt);
  const html = renderTaskReceiptHtml(receipt, proof);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Vraxis verified task receipt/);
  assert.match(html, />Verified</);
  assert.match(html, /sample&amp;project/);
  assert.match(html, /src\/&lt;unsafe&gt;\.ts/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /supersecret|anothersecret/);
  assert.match(html, /REDACTED API KEY/);
  assert.match(html, /Recipe <code>a{64}<\/code>/);
  assert.match(html, /vraxis-code:\/\/task\/session-proof\?evidence=change&amp;target=src%2F%3Cunsafe%3E\.ts/);
  assert.match(html, /vraxis-code:\/\/task\/session-proof\?evidence=terminal&amp;target=terminal-proof/);
});
