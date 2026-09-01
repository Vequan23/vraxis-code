import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ApprovalRequest } from "@vraxis/agent-v";
import type { TeamPolicyBundleV1 } from "@vraxis/code-contracts";
import { ApprovalRegistry } from "../src/approvals/approval-registry.js";
import { ProofTrustRegistry } from "../src/receipts/proof-trust.js";
import { TaskProofSigner } from "../src/receipts/task-proof.js";
import { TeamPolicyRegistry } from "../src/team-policy/team-policy-registry.js";

async function policyRegistry(root: string) {
  const signer = new TaskProofSigner(root);
  const trust = new ProofTrustRegistry(root);
  return { signer, trust, policy: new TeamPolicyRegistry(root, signer, trust) };
}

test("imports a trusted signed team policy and applies ask and deny precedence", async () => {
  const adminRoot = await mkdtemp(join(tmpdir(), "vraxis-policy-admin-"));
  const deviceRoot = await mkdtemp(join(tmpdir(), "vraxis-policy-device-"));
  const admin = await policyRegistry(adminRoot);
  const device = await policyRegistry(deviceRoot);
  const bundle = await admin.policy.create({
    organization: "Example Engineering",
    rules: [
      { capability: "command", effect: "ask" },
      { capability: "credentials", effect: "deny" },
    ],
  });

  await assert.rejects(device.policy.install(bundle), /Trust this team policy signer/);
  await device.trust.enroll("Example policy admin", (await admin.signer.identity()).publicKey, await device.signer.identity());
  const installed = await device.policy.install(bundle);
  assert.equal(installed.status, "active");
  assert.equal(installed.policy?.signerLabel, "Example policy admin");

  const remembered = new ApprovalRegistry(deviceRoot, undefined, async () => "full-access");
  const original = await remembered.request({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "command",
    title: "Run tests",
    description: "Run tests.",
    scope: ". · npm test",
    risk: "medium",
    source: "terminal",
  });
  await remembered.decide(original.id, "approve", "project");

  const governed = new ApprovalRegistry(deviceRoot, (input) => device.policy.decision(input));
  const command = await governed.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "command",
    title: "Run tests",
    description: "Run tests.",
    scope: ". · npm test",
    risk: "medium",
    source: "terminal",
  });
  assert.equal(command.state, "pending", "team ask must override a remembered allow");
  assert.equal(command.rememberable, false);
  assert.equal(command.teamPolicy?.effect, "ask");
  await assert.rejects(governed.decide(command.id, "approve", "project"), /fresh decision|does not allow/);

  const credential = await governed.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "credentials",
    title: "Read credential",
    description: "Read one credential.",
    scope: "OPENAI_API_KEY",
    risk: "high",
    source: "agent",
  });
  assert.equal(credential.state, "denied");
  assert.match(credential.failure ?? "", /blocked by Example Engineering policy/);
  assert.equal(credential.teamPolicy?.effect, "deny");

  const agentRequest: ApprovalRequest = {
    id: "agent-credential-request",
    runId: "run-1",
    toolName: "credentials-read",
    input: { name: "OPENAI_API_KEY" },
    reason: "Read one credential.",
    category: "credentials",
    risk: "privileged",
    sideEffect: "read",
    requiredPermissions: ["credentials:read"],
    scope: {
      tenantId: "local",
      projectId: "project-1",
      principalId: "local-user",
      roles: ["owner"],
      permissions: ["*"],
      dataClassification: "confidential",
    },
  };
  assert.equal(await governed.policy("session-2", "project-1").decide(agentRequest), "denied");
  assert.equal((await governed.list("session-2")).find((item) => item.id === agentRequest.id)?.teamPolicy?.effect, "deny");

  const browser = await governed.request({
    sessionId: "session-2",
    projectId: "project-1",
    capability: "browser",
    title: "Capture",
    description: "Capture browser evidence.",
    scope: "active page",
    risk: "low",
    source: "browser",
  });
  assert.equal(browser.state, "pending");
  assert.equal(browser.teamPolicy, undefined);
});

test("rejects tampered and expired team policies and deactivates a revoked signer", async () => {
  const adminRoot = await mkdtemp(join(tmpdir(), "vraxis-policy-admin-"));
  const deviceRoot = await mkdtemp(join(tmpdir(), "vraxis-policy-device-"));
  const admin = await policyRegistry(adminRoot);
  const device = await policyRegistry(deviceRoot);
  const bundle = await admin.policy.create({
    organization: "Example Engineering",
    rules: [{ capability: "destructive", effect: "deny" }],
  });
  const identity = await admin.signer.identity();
  await device.trust.enroll("Example policy admin", identity.publicKey, await device.signer.identity());

  const tampered = structuredClone(bundle);
  tampered.rules[0]!.reason = "Allow everything.";
  await assert.rejects(device.policy.install(tampered), /signature or digest is invalid/);

  const expiredPayload = {
    kind: "vraxis.team-policy" as const,
    version: 1 as const,
    policyId: "expired-policy",
    organization: "Example Engineering",
    issuedAt: "2025-01-01T00:00:00.000Z",
    expiresAt: "2025-02-01T00:00:00.000Z",
    rules: [{ id: "destructive:deny", capability: "destructive" as const, effect: "deny" as const, reason: "Blocked." }],
  };
  const expired: TeamPolicyBundleV1 = { ...expiredPayload, ...await admin.signer.signArtifact(expiredPayload) };
  await assert.rejects(device.policy.install(expired), /has expired/);

  await device.policy.install(bundle);
  assert.equal((await device.policy.state()).status, "active");
  await device.trust.revoke(identity.keyId);
  assert.equal((await device.policy.state()).status, "untrusted");
  assert.deepEqual(await device.policy.decision({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "destructive",
    title: "Delete",
    description: "Delete files.",
    scope: "src",
    risk: "high",
    source: "agent",
  }), { forceFresh: true });
  assert.equal((await device.policy.remove(true)).status, "none");
});

test("fails safe when the installed policy file is corrupted", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-policy-corrupt-"));
  const device = await policyRegistry(root);
  await writeFile(device.policy.file, "{not-json\n");
  assert.deepEqual(await device.policy.state(), { status: "untrusted" });
  assert.deepEqual(await device.policy.decision({
    sessionId: "session-1",
    projectId: "project-1",
    capability: "command",
    title: "Run command",
    description: "Run one command.",
    scope: ". · npm test",
    risk: "medium",
    source: "terminal",
  }), { forceFresh: true });
  assert.equal((await device.policy.remove(true)).status, "none");
});
