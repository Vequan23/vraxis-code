import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localExecutionScope } from "@vraxis/agent-v";
import { executeAgentTool } from "@vraxis/agent-v/tools";
import { createAgentVerificationHandoffTool } from "../src/sessions/agent-verification-handoff-tool.js";
import { VerificationRegistry } from "../src/verification/verification-registry.js";

test("records one durable verification handoff without choosing or executing a recipe", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-handoff-"));
  const verifications = new VerificationRegistry(root);
  const tool = createAgentVerificationHandoffTool({
    sessionId: "session-1",
    runtimeId: "claude-code",
    modelId: "sonnet",
    verifications,
  });
  const context = {
    tool,
    runId: "run-1",
    sessionId: "session-1",
    scope: localExecutionScope("project-1"),
  };

  const first = await executeAgentTool({ ...context, input: { note: "Run the project-owned checks and browser assertions." } });
  const second = await executeAgentTool({ ...context, input: { note: "Use only the retained project recipe." } });
  const handoffs = await new VerificationRegistry(root).listHandoffs("session-1");

  assert.equal(first.handoffId, second.handoffId);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0]?.state, "requested");
  assert.equal(handoffs[0]?.requestedBy.runtimeId, "claude-code");
  assert.equal(handoffs[0]?.requestedBy.modelId, "sonnet");
  assert.equal(handoffs[0]?.note, "Use only the retained project recipe.");
  assert.equal((await verifications.list()).length, 0, "the agent request must not create or run verification");
  const dismissedRequest = await verifications.requestHandoff({ sessionId: "session-2", runtimeId: "codex" });
  const dismissed = await verifications.resolveHandoff(dismissedRequest.id, "dismissed");
  assert.equal(dismissed.state, "dismissed");
  assert.equal(dismissed.verificationRunId, undefined);
  await assert.rejects(verifications.resolveHandoff(dismissed.id, "dismissed"), /already been resolved/);
  await assert.rejects(
    executeAgentTool({ ...context, input: { note: "x".repeat(501) } }),
    /limited to 500 characters/,
  );
});
