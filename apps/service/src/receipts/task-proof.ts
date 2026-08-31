import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  TaskEvidenceKindV1,
  TaskEvidenceLinkV1,
  ProofIdentitySummary,
  ProofKeyRotationAttestationV1,
  ProofKeyRotationSignatureV1,
  ProofKeyRotationSummary,
  TaskProofEnvelopeV1,
  TaskProofIntegrityV1,
  TaskReceiptV1,
} from "@vraxis/code-contracts";
import { canonicalJson, canonicalJsonBytes, sha256Hex } from "./canonical-json.js";

interface StoredProofKeyV1 {
  version: 1;
  privateKey: string;
  publicKey: string;
}

interface TaskProofPayloadV1 {
  kind: "vraxis.task-proof";
  version: 1;
  generatedAt: string;
  deepLink: string;
  evidenceLinks?: TaskEvidenceLinkV1[];
  receipt: TaskReceiptV1;
}

interface ProofKeyRotationPayloadV1 {
  kind: "vraxis.proof-key-rotation";
  version: 1;
  rotatedAt: string;
  previousIdentity: ProofIdentitySummary;
  nextIdentity: ProofIdentitySummary;
}

function taskDeepLink(sessionId: string): string {
  return `vraxis-code://task/${encodeURIComponent(sessionId)}`;
}

function evidenceDeepLink(sessionId: string, kind: TaskEvidenceKindV1, target: string): string {
  const query = new URLSearchParams({ evidence: kind, target });
  return `${taskDeepLink(sessionId)}?${query.toString()}`;
}

export function taskEvidenceLinks(receipt: TaskReceiptV1): TaskEvidenceLinkV1[] {
  const sessionId = receipt.session.id;
  return [
    ...receipt.changes.map((change) => ({
      kind: "change" as const,
      target: change.path,
      label: change.path,
      deepLink: evidenceDeepLink(sessionId, "change", change.path),
    })),
    ...receipt.terminalRuns.map((run) => ({
      kind: "terminal" as const,
      target: run.id,
      label: run.command,
      deepLink: evidenceDeepLink(sessionId, "terminal", run.id),
    })),
    ...receipt.approvals.map((approval) => ({
      kind: "approval" as const,
      target: approval.id,
      label: approval.title,
      deepLink: evidenceDeepLink(sessionId, "approval", approval.id),
    })),
    ...(receipt.browser?.actions ?? []).map((action) => ({
      kind: "browser" as const,
      target: action.id,
      label: `${action.action} · ${action.target}`,
      deepLink: evidenceDeepLink(sessionId, "browser", action.id),
    })),
  ];
}

export function canonicalTaskProofPayload(payload: TaskProofPayloadV1): Buffer {
  return canonicalJsonBytes(payload);
}

function payloadFromEnvelope(envelope: TaskProofEnvelopeV1): TaskProofPayloadV1 {
  return {
    kind: envelope.kind,
    version: envelope.version,
    generatedAt: envelope.generatedAt,
    deepLink: envelope.deepLink,
    ...(envelope.evidenceLinks ? { evidenceLinks: envelope.evidenceLinks } : {}),
    receipt: envelope.receipt,
  };
}

function parseStoredKey(raw: string): StoredProofKeyV1 {
  const value = JSON.parse(raw) as Partial<StoredProofKeyV1>;
  if (value.version !== 1 || typeof value.privateKey !== "string" || typeof value.publicKey !== "string") {
    throw new TypeError("The task-proof signing key is invalid.");
  }
  createPrivateKey(value.privateKey);
  createPublicKey(value.publicKey);
  return value as StoredProofKeyV1;
}

function identityForStoredKey(stored: StoredProofKeyV1): ProofIdentitySummary {
  const publicDer = createPublicKey(stored.publicKey).export({ format: "der", type: "spki" });
  return {
    keyId: sha256Hex(publicDer),
    publicKey: publicDer.toString("base64"),
    publicKeyFormat: "spki-base64",
    algorithm: "Ed25519",
  };
}

function rotationSignature(stored: StoredProofKeyV1, payload: Buffer): ProofKeyRotationSignatureV1 {
  return {
    ...identityForStoredKey(stored),
    signature: sign(null, payload, createPrivateKey(stored.privateKey)).toString("base64"),
  };
}

function verifyRotationSignature(
  signature: ProofKeyRotationSignatureV1,
  identity: ProofIdentitySummary,
  payload: Buffer,
): boolean {
  if (signature.algorithm !== "Ed25519" || signature.publicKeyFormat !== "spki-base64") return false;
  if (signature.keyId !== identity.keyId || signature.publicKey !== identity.publicKey) return false;
  const publicDer = Buffer.from(signature.publicKey, "base64");
  const expectedKey = Buffer.from(sha256Hex(publicDer), "hex");
  const actualKey = Buffer.from(signature.keyId, "hex");
  if (expectedKey.length !== actualKey.length || !timingSafeEqual(expectedKey, actualKey)) return false;
  const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
  return publicKey.asymmetricKeyType === "ed25519"
    && verify(null, payload, publicKey, Buffer.from(signature.signature, "base64"));
}

function rotationPayload(attestation: ProofKeyRotationAttestationV1): ProofKeyRotationPayloadV1 {
  return {
    kind: attestation.kind,
    version: attestation.version,
    rotatedAt: attestation.rotatedAt,
    previousIdentity: attestation.previousIdentity,
    nextIdentity: attestation.nextIdentity,
  };
}

export function verifyProofKeyRotation(attestation: ProofKeyRotationAttestationV1): boolean {
  try {
    if (attestation.kind !== "vraxis.proof-key-rotation" || attestation.version !== 1) return false;
    if (attestation.previousIdentity.keyId === attestation.nextIdentity.keyId) return false;
    if (attestation.integrity.canonicalization !== "vraxis-json-c14n-v1"
      || attestation.integrity.digestAlgorithm !== "SHA-256") return false;
    const payload = canonicalJsonBytes(rotationPayload(attestation));
    const digest = sha256Hex(payload);
    if (attestation.artifactId !== `sha256:${digest}` || attestation.integrity.digest !== digest) return false;
    return verifyRotationSignature(attestation.integrity.previousSignature, attestation.previousIdentity, payload)
      && verifyRotationSignature(attestation.integrity.nextSignature, attestation.nextIdentity, payload);
  } catch {
    return false;
  }
}

export function verifyTaskProof(envelope: TaskProofEnvelopeV1): boolean {
  try {
    if (envelope.kind !== "vraxis.task-proof" || envelope.version !== 1) return false;
    if (envelope.deepLink !== taskDeepLink(envelope.receipt.session.id)) return false;
    if (envelope.evidenceLinks
      && canonicalJson(envelope.evidenceLinks) !== canonicalJson(taskEvidenceLinks(envelope.receipt))) return false;
    const payload = canonicalTaskProofPayload(payloadFromEnvelope(envelope));
    return verifySignedPayload(payload, envelope.artifactId, envelope.integrity);
  } catch {
    return false;
  }
}

export function verifySignedPayload(
  canonicalPayload: Buffer,
  artifactId: string,
  integrity: TaskProofIntegrityV1,
): boolean {
  try {
    const digest = sha256Hex(canonicalPayload);
    if (artifactId !== `sha256:${digest}` || integrity.digest !== digest) return false;
    if (integrity.algorithm !== "Ed25519"
      || integrity.canonicalization !== "vraxis-json-c14n-v1"
      || integrity.digestAlgorithm !== "SHA-256"
      || integrity.publicKeyFormat !== "spki-base64") return false;
    const publicDer = Buffer.from(integrity.publicKey, "base64");
    const expectedKey = Buffer.from(sha256Hex(publicDer), "hex");
    const actualKey = Buffer.from(integrity.keyId, "hex");
    if (expectedKey.length !== actualKey.length || !timingSafeEqual(expectedKey, actualKey)) return false;
    const publicKey = createPublicKey({ key: publicDer, format: "der", type: "spki" });
    return publicKey.asymmetricKeyType === "ed25519"
      && verify(null, canonicalPayload, publicKey, Buffer.from(integrity.signature, "base64"));
  } catch {
    return false;
  }
}

export class TaskProofSigner {
  private readonly directory: string;
  private readonly file: string;
  private readonly rotationsDirectory: string;
  private keyPromise?: Promise<StoredProofKeyV1>;
  private operations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.directory = join(dataDirectory, "proof");
    this.file = join(this.directory, "signing-key.json");
    this.rotationsDirectory = join(this.directory, "rotations");
  }

  async create(receipt: TaskReceiptV1): Promise<TaskProofEnvelopeV1> {
    return this.serialize(async () => {
      const stored = await this.key();
      const payload: TaskProofPayloadV1 = {
        kind: "vraxis.task-proof",
        version: 1,
        generatedAt: receipt.generatedAt,
        deepLink: taskDeepLink(receipt.session.id),
        evidenceLinks: taskEvidenceLinks(receipt),
        receipt,
      };
      const canonical = canonicalTaskProofPayload(payload);
      const signed = this.signWithStored(stored, canonical);
      return {
        ...payload,
        ...signed,
      };
    });
  }

  async signArtifact(payload: object): Promise<{ artifactId: string; integrity: TaskProofIntegrityV1 }> {
    return this.serialize(async () => this.signWithStored(await this.key(), canonicalJsonBytes(payload)));
  }

  async identity(): Promise<ProofIdentitySummary> {
    return this.serialize(async () => identityForStoredKey(await this.key()));
  }

  async rotate(
    beforeCommit: (previous: ProofIdentitySummary, next: ProofIdentitySummary, rotatedAt: string) => Promise<void>,
  ): Promise<ProofKeyRotationAttestationV1> {
    return this.serialize(async () => {
      const previous = await this.key();
      const keys = generateKeyPairSync("ed25519");
      const next: StoredProofKeyV1 = {
        version: 1,
        privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
      };
      const payload: ProofKeyRotationPayloadV1 = {
        kind: "vraxis.proof-key-rotation",
        version: 1,
        rotatedAt: new Date().toISOString(),
        previousIdentity: identityForStoredKey(previous),
        nextIdentity: identityForStoredKey(next),
      };
      const canonical = canonicalJsonBytes(payload);
      const digest = sha256Hex(canonical);
      const attestation: ProofKeyRotationAttestationV1 = {
        ...payload,
        artifactId: `sha256:${digest}`,
        integrity: {
          canonicalization: "vraxis-json-c14n-v1",
          digestAlgorithm: "SHA-256",
          digest,
          previousSignature: rotationSignature(previous, canonical),
          nextSignature: rotationSignature(next, canonical),
        },
      };
      await beforeCommit(payload.previousIdentity, payload.nextIdentity, payload.rotatedAt);
      await mkdir(this.rotationsDirectory, { recursive: true, mode: 0o700 });
      await chmod(this.rotationsDirectory, 0o700);
      const rotationFile = join(
        this.rotationsDirectory,
        `${Date.parse(payload.rotatedAt)}-${payload.previousIdentity.keyId.slice(0, 12)}-${payload.nextIdentity.keyId.slice(0, 12)}.json`,
      );
      await writeFile(rotationFile, `${JSON.stringify(attestation, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, this.file);
      await chmod(this.file, 0o600);
      this.keyPromise = Promise.resolve(next);
      return attestation;
    });
  }

  async rotationHistory(): Promise<ProofKeyRotationSummary[]> {
    return this.serialize(async () => {
      try {
        const names = (await readdir(this.rotationsDirectory)).filter((name) => name.endsWith(".json")).sort().reverse();
        const rotations: ProofKeyRotationSummary[] = [];
        for (const name of names.slice(0, 50)) {
          try {
            const attestation = JSON.parse(await readFile(join(this.rotationsDirectory, name), "utf8")) as ProofKeyRotationAttestationV1;
            if (!verifyProofKeyRotation(attestation)) continue;
            rotations.push({
              artifactId: attestation.artifactId,
              rotatedAt: attestation.rotatedAt,
              previousKeyId: attestation.previousIdentity.keyId,
              nextKeyId: attestation.nextIdentity.keyId,
            });
          } catch {
            // A malformed attestation is ignored without weakening the active identity.
          }
        }
        return rotations;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    });
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    let output!: T;
    const queued = this.operations.then(async () => { output = await operation(); });
    this.operations = queued.then(() => undefined, () => undefined);
    await queued;
    return output;
  }

  private signWithStored(
    stored: StoredProofKeyV1,
    canonical: Buffer,
  ): { artifactId: string; integrity: TaskProofIntegrityV1 } {
    const digest = sha256Hex(canonical);
    const identity = identityForStoredKey(stored);
    return {
      artifactId: `sha256:${digest}`,
      integrity: {
        algorithm: "Ed25519",
        canonicalization: "vraxis-json-c14n-v1",
        digestAlgorithm: "SHA-256",
        digest,
        signature: sign(null, canonical, createPrivateKey(stored.privateKey)).toString("base64"),
        publicKey: identity.publicKey,
        publicKeyFormat: identity.publicKeyFormat,
        keyId: identity.keyId,
      },
    };
  }

  private async key(): Promise<StoredProofKeyV1> {
    this.keyPromise ??= this.loadOrCreate();
    return this.keyPromise;
  }

  private async loadOrCreate(): Promise<StoredProofKeyV1> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    try {
      const stored = parseStoredKey(await readFile(this.file, "utf8"));
      await chmod(this.file, 0o600);
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const keys = generateKeyPairSync("ed25519");
    const stored: StoredProofKeyV1 = {
      version: 1,
      privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    };
    try {
      await writeFile(this.file, `${JSON.stringify(stored)}\n`, { flag: "wx", mode: 0o600 });
      return stored;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = parseStoredKey(await readFile(this.file, "utf8"));
      await chmod(this.file, 0o600);
      return existing;
    }
  }
}
