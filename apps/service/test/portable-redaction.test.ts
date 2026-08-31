import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { TaskReceiptV1 } from "@vraxis/code-contracts";
import { redactPortableText, redactTaskReceipt } from "../src/receipts/portable-redaction.js";
import { TaskProofSigner, verifyTaskProof } from "../src/receipts/task-proof.js";

function sensitiveReceipt(): TaskReceiptV1 {
  return {
    kind: "vraxis.task-receipt",
    version: 1,
    generatedAt: "2026-08-31T12:00:00.000Z",
    session: { id: "session-1", title: "Prove safely", mode: "build", status: "complete", runtimeId: "codex", updatedAt: "2026-08-31T12:00:00.000Z" },
    project: { id: "project-1", name: "sample", branch: "main" },
    changes: [],
    approvals: [{
      id: "approval-1",
      sessionId: "session-1",
      source: "terminal",
      capability: "command",
      risk: "high",
      title: "Run authenticated check",
      description: "Verify the build",
      scope: "TOKEN=approval-secret-value",
      state: "completed",
      requestedAt: "2026-08-31T12:00:00.000Z",
      resolvedAt: "2026-08-31T12:00:02.000Z",
    }],
    terminalRuns: [{
      id: "terminal-1",
      sessionId: "session-1",
      approvalId: "approval-1",
      command: "node verify.js --token terminal-secret-value",
      cwd: ".",
      status: "success",
      output: "Authorization: Bearer bearer-secret-value\nAPI_KEY=output-secret-value\nhttps://example.test/callback?code=url-secret-value#fragment\n",
    }],
    browser: {
      url: "https://example.test/account?session=browser-secret-value#profile",
      title: "Account",
      viewport: { width: 1280, height: 820 },
      actions: [{ id: "action-1", action: "navigate", target: "https://example.test/account?token=action-secret-value#fragment", status: "success", timestamp: "2026-08-31T12:00:00.000Z", detail: "Opened the account." }],
      console: [],
      network: [{ id: "network-1", method: "GET", url: "https://example.test/api?key=network-secret-value", resourceType: "fetch", state: "complete", startedAt: "2026-08-31T12:00:00.000Z" }],
    },
    activity: [],
  };
}

test("redacts credentials and URL payloads from portable signed evidence", async () => {
  const raw = sensitiveReceipt();
  const redacted = redactTaskReceipt(raw);
  const serialized = JSON.stringify(redacted);

  for (const secret of ["approval-secret-value", "terminal-secret-value", "bearer-secret-value", "output-secret-value", "url-secret-value", "browser-secret-value", "action-secret-value", "network-secret-value", "#fragment", "#profile"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.match(serialized, /REDACTED/);
  assert.match(redacted.browser?.url ?? "", /session=%5BREDACTED%5D/);
  assert.match(redacted.terminalRuns[0]?.output ?? "", /code=%5BREDACTED%5D/);
  assert.match(raw.terminalRuns[0]?.command ?? "", /terminal-secret-value/, "redaction must not mutate retained local evidence");

  const proof = await new TaskProofSigner(await mkdtemp(join(tmpdir(), "vraxis-redacted-proof-"))).create(redacted);
  assert.equal(verifyTaskProof(proof), true);
  assert.doesNotMatch(JSON.stringify(proof), /secret-value/);
});

test("redacts common credential forms without hiding ordinary command output", () => {
  const value = redactPortableText("passed\n--password hunter2\nBasic dXNlcjpwYXNzd29yZA==\nstatus=ready");
  assert.match(value, /^passed/m);
  assert.match(value, /--password \[REDACTED\]/);
  assert.match(value, /Basic \[REDACTED\]/);
  assert.match(value, /status=ready/);
});
