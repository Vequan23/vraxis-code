import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import type { TaskProofEnvelopeV1, TaskReceiptV1 } from "@vraxis/code-contracts";
import {
  canonicalTaskProofPayload,
  TaskProofSigner,
  verifyProofKeyRotation,
  verifyTaskProof,
} from "../src/receipts/task-proof.js";
import { ProofTrustRegistry } from "../src/receipts/proof-trust.js";

function receipt(): TaskReceiptV1 {
  return {
    kind: "vraxis.task-receipt",
    version: 1,
    generatedAt: "2026-08-31T12:00:00.000Z",
    session: {
      id: "session-1",
      title: "Prove the task",
      mode: "build",
      status: "complete",
      runtimeId: "codex",
      modelId: "gpt-5.6",
      updatedAt: "2026-08-31T11:59:00.000Z",
    },
    project: { id: "project-1", name: "sample", branch: "main" },
    changes: [{ path: "src/index.ts", status: "modified" }],
    approvals: [],
    terminalRuns: [],
    verificationRuns: [],
    activity: [],
  };
}

test("creates a self-verifying signed task proof with a stable local identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-task-proof-"));
  const first = await new TaskProofSigner(root).create(receipt());
  const second = await new TaskProofSigner(root).create(receipt());

  assert.equal(first.deepLink, "vraxis-code://task/session-1");
  assert.deepEqual(first.evidenceLinks?.map((item) => [item.kind, item.target]), [
    ["change", "src/index.ts"],
  ]);
  assert.equal(first.evidenceLinks?.[0]?.deepLink, "vraxis-code://task/session-1?evidence=change&target=src%2Findex.ts");
  assert.match(first.artifactId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.integrity.keyId, second.integrity.keyId);
  assert.equal(first.integrity.signature, second.integrity.signature);
  assert.equal(verifyTaskProof(first), true);
  assert.equal((await stat(join(root, "proof"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, "proof", "signing-key.json"))).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE KEY/);
});

test("rejects proof, deep-link, signature, and receipt tampering", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-task-proof-tamper-"));
  const original = await new TaskProofSigner(root).create(receipt());

  const changedReceipt = structuredClone(original) as TaskProofEnvelopeV1;
  changedReceipt.receipt.session.title = "A different task";
  assert.equal(verifyTaskProof(changedReceipt), false);

  const changedLink = structuredClone(original) as TaskProofEnvelopeV1;
  changedLink.deepLink = "vraxis-code://task/someone-else";
  assert.equal(verifyTaskProof(changedLink), false);

  const changedEvidenceLink = structuredClone(original) as TaskProofEnvelopeV1;
  changedEvidenceLink.evidenceLinks![0]!.deepLink = "vraxis-code://task/session-1?evidence=change&target=other.ts";
  assert.equal(verifyTaskProof(changedEvidenceLink), false);

  const changedSignature = structuredClone(original) as TaskProofEnvelopeV1;
  changedSignature.integrity.signature = Buffer.from("not a signature").toString("base64");
  assert.equal(verifyTaskProof(changedSignature), false);
});

test("continues to verify proof envelopes created before evidence links were introduced", () => {
  const keys = generateKeyPairSync("ed25519");
  const payload = {
    kind: "vraxis.task-proof" as const,
    version: 1 as const,
    generatedAt: receipt().generatedAt,
    deepLink: "vraxis-code://task/session-1",
    receipt: receipt(),
  };
  const canonical = canonicalTaskProofPayload(payload);
  const digest = createHash("sha256").update(canonical).digest("hex");
  const publicDer = keys.publicKey.export({ format: "der", type: "spki" });
  const legacy: TaskProofEnvelopeV1 = {
    ...payload,
    artifactId: `sha256:${digest}`,
    integrity: {
      algorithm: "Ed25519",
      canonicalization: "vraxis-json-c14n-v1",
      digestAlgorithm: "SHA-256",
      digest,
      signature: sign(null, canonical, keys.privateKey).toString("base64"),
      publicKey: publicDer.toString("base64"),
      publicKeyFormat: "spki-base64",
      keyId: createHash("sha256").update(publicDer).digest("hex"),
    },
  };
  assert.equal(verifyTaskProof(legacy), true);
});

test("enrolls, verifies, and revokes a portable proof identity without private key material", async () => {
  const localRoot = await mkdtemp(join(tmpdir(), "vraxis-proof-trust-local-"));
  const remoteRoot = await mkdtemp(join(tmpdir(), "vraxis-proof-trust-remote-"));
  const local = new TaskProofSigner(localRoot);
  const remote = new TaskProofSigner(remoteRoot);
  const trust = new ProofTrustRegistry(localRoot);
  const localIdentity = await local.identity();
  const remoteIdentity = await remote.identity();
  const remoteProof = await remote.create(receipt());

  assert.equal((await trust.verify(await local.create(receipt()), localIdentity)).trust, "local");
  const before = await trust.verify(remoteProof, localIdentity);
  assert.deepEqual({ signature: before.signature, trust: before.trust }, { signature: "valid", trust: "untrusted" });

  const enrolled = await trust.enroll("Build server", remoteIdentity.publicKey, localIdentity);
  assert.equal(enrolled.keyId, remoteIdentity.keyId);
  assert.doesNotMatch(JSON.stringify(enrolled), /PRIVATE KEY/);
  const trusted = await trust.verify(remoteProof, localIdentity);
  assert.equal(trusted.trust, "trusted");
  assert.equal(trusted.signerLabel, "Build server");
  assert.equal((await stat(join(localRoot, "proof", "trusted-signers.json"))).mode & 0o777, 0o600);

  await trust.revoke(remoteIdentity.keyId);
  assert.equal((await trust.verify(remoteProof, localIdentity)).trust, "untrusted");
  assert.ok((await trust.state(localIdentity)).signers[0]?.revokedAt);
  await trust.retainFormerLocalIdentity(remoteIdentity, localIdentity, "2026-08-31T12:30:00.000Z");
  assert.ok((await trust.state(localIdentity)).signers[0]?.revokedAt, "rotation must not restore revoked trust");
  await assert.rejects(trust.enroll("This device", localIdentity.publicKey, localIdentity), /already trusted locally/);
});

test("rotates the local signing identity while preserving old proof trust and a dual-signed audit trail", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-proof-rotation-"));
  const signer = new TaskProofSigner(root);
  const trust = new ProofTrustRegistry(root);
  const previousProof = await signer.create(receipt());
  const previousIdentity = await signer.identity();

  const attestation = await signer.rotate((previous, next, rotatedAt) => (
    trust.retainFormerLocalIdentity(previous, next, rotatedAt).then(() => undefined)
  ));
  const nextIdentity = await signer.identity();
  const nextProof = await signer.create(receipt());

  assert.notEqual(nextIdentity.keyId, previousIdentity.keyId);
  assert.equal(attestation.previousIdentity.keyId, previousIdentity.keyId);
  assert.equal(attestation.nextIdentity.keyId, nextIdentity.keyId);
  assert.equal(verifyProofKeyRotation(attestation), true);
  assert.equal((await trust.verify(previousProof, nextIdentity)).trust, "trusted");
  assert.equal((await trust.verify(nextProof, nextIdentity)).trust, "local");
  assert.equal((await signer.rotationHistory())[0]?.artifactId, attestation.artifactId);
  assert.equal((await stat(join(root, "proof", "rotations"))).mode & 0o777, 0o700);
  const rotationNames = await import("node:fs/promises").then(({ readdir }) => readdir(join(root, "proof", "rotations")));
  assert.equal((await stat(join(root, "proof", "rotations", rotationNames[0]!))).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(attestation), /PRIVATE KEY/);

  const tampered = structuredClone(attestation);
  tampered.nextIdentity.keyId = previousIdentity.keyId;
  assert.equal(verifyProofKeyRotation(tampered), false);
});
