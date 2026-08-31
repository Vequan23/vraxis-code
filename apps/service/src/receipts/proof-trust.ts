import { createHash, createPublicKey } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProofIdentitySummary,
  ProofKeyRotationSummary,
  ProofTrustState,
  ProofVerificationSummary,
  TaskProofEnvelopeV1,
  TrustedProofSignerSummary,
} from "@vraxis/code-contracts";
import { verifyTaskProof } from "./task-proof.js";

interface ProofTrustData {
  schemaVersion: 1;
  signers: TrustedProofSignerSummary[];
}

const emptyData: ProofTrustData = { schemaVersion: 1, signers: [] };

function normalizePublicKey(value: string): ProofIdentitySummary {
  if (!value.trim() || value.length > 4_096) throw new TypeError("Enter a bounded SPKI public key.");
  let der: Buffer;
  try {
    der = Buffer.from(value.trim(), "base64");
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new TypeError("Only Ed25519 proof identities are supported.");
    der = key.export({ format: "der", type: "spki" });
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("Ed25519")) throw error;
    throw new TypeError("The proof identity must be an Ed25519 SPKI key encoded as base64.");
  }
  return {
    keyId: createHash("sha256").update(der).digest("hex"),
    publicKey: der.toString("base64"),
    publicKeyFormat: "spki-base64",
    algorithm: "Ed25519",
  };
}

export class ProofTrustRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "proof", "trusted-signers.json");
  }

  async state(identity: ProofIdentitySummary, rotations: ProofKeyRotationSummary[] = []): Promise<ProofTrustState> {
    const data = await this.read();
    return {
      identity,
      ...(rotations.length ? { rotations } : {}),
      signers: [...data.signers].sort((left, right) => {
        if (Boolean(left.revokedAt) !== Boolean(right.revokedAt)) return left.revokedAt ? 1 : -1;
        return right.enrolledAt.localeCompare(left.enrolledAt);
      }),
    };
  }

  async retainFormerLocalIdentity(
    previous: ProofIdentitySummary,
    next: ProofIdentitySummary,
    rotatedAt: string,
  ): Promise<TrustedProofSignerSummary> {
    const normalized = normalizePublicKey(previous.publicKey);
    if (normalized.keyId !== previous.keyId) throw new TypeError("The previous proof identity is inconsistent.");
    if (normalized.keyId === next.keyId) throw new TypeError("Proof-key rotation must create a distinct identity.");
    return this.mutate((data) => {
      const existing = data.signers.find((signer) => signer.keyId === normalized.keyId);
      if (existing) {
        // Rotation must never silently restore an identity that a user revoked.
        if (!existing.revokedAt) existing.label = `This installation · retired ${rotatedAt.slice(0, 10)}`;
        return existing;
      }
      const signer: TrustedProofSignerSummary = {
        ...normalized,
        label: `This installation · retired ${rotatedAt.slice(0, 10)}`,
        enrolledAt: rotatedAt,
      };
      data.signers.unshift(signer);
      return signer;
    });
  }

  async enroll(labelValue: string, publicKey: string, localIdentity: ProofIdentitySummary): Promise<TrustedProofSignerSummary> {
    const label = labelValue.trim();
    if (!label || label.length > 80) throw new TypeError("Give this proof identity a label of 80 characters or fewer.");
    const identity = normalizePublicKey(publicKey);
    if (identity.keyId === localIdentity.keyId) throw new TypeError("This device identity is already trusted locally.");
    return this.mutate((data) => {
      const existing = data.signers.find((signer) => signer.keyId === identity.keyId);
      const enrolledAt = new Date().toISOString();
      if (existing) {
        existing.label = label;
        existing.enrolledAt = enrolledAt;
        existing.publicKey = identity.publicKey;
        delete existing.revokedAt;
        return existing;
      }
      const signer: TrustedProofSignerSummary = { ...identity, label, enrolledAt };
      data.signers.unshift(signer);
      return signer;
    });
  }

  async revoke(keyId: string): Promise<TrustedProofSignerSummary> {
    return this.mutate((data) => {
      const signer = data.signers.find((item) => item.keyId === keyId);
      if (!signer) throw new TypeError("The trusted proof identity was not found.");
      signer.revokedAt ??= new Date().toISOString();
      return signer;
    });
  }

  async verify(envelope: TaskProofEnvelopeV1, localIdentity: ProofIdentitySummary): Promise<ProofVerificationSummary> {
    if (!verifyTaskProof(envelope)) {
      return { signature: "invalid", trust: "untrusted", detail: "The proof signature, digest, evidence links, or canonical payload is invalid." };
    }
    const keyId = envelope.integrity.keyId;
    if (keyId === localIdentity.keyId && envelope.integrity.publicKey === localIdentity.publicKey) {
      return {
        signature: "valid",
        trust: "local",
        keyId,
        artifactId: envelope.artifactId,
        detail: "The proof is valid and was signed by this Vraxis Code installation.",
      };
    }
    const signer = (await this.read()).signers.find((item) => !item.revokedAt
      && item.keyId === keyId
      && item.publicKey === envelope.integrity.publicKey);
    return {
      signature: "valid",
      trust: signer ? "trusted" : "untrusted",
      keyId,
      ...(signer ? { signerLabel: signer.label } : {}),
      artifactId: envelope.artifactId,
      detail: signer
        ? `The proof is valid and its signer is enrolled as ${signer.label}.`
        : "The proof is cryptographically valid, but its signer is not trusted on this installation.",
    };
  }

  async trustIdentity(
    keyId: string,
    publicKey: string,
    localIdentity: ProofIdentitySummary,
  ): Promise<{ trust: "local" | "trusted" | "untrusted"; label?: string }> {
    let identity: ProofIdentitySummary;
    try { identity = normalizePublicKey(publicKey); } catch { return { trust: "untrusted" }; }
    if (identity.keyId !== keyId) return { trust: "untrusted" };
    if (identity.keyId === localIdentity.keyId && identity.publicKey === localIdentity.publicKey) {
      return { trust: "local", label: "This installation" };
    }
    const signer = (await this.read()).signers.find((item) => !item.revokedAt
      && item.keyId === identity.keyId
      && item.publicKey === identity.publicKey);
    return signer ? { trust: "trusted", label: signer.label } : { trust: "untrusted" };
  }

  private async read(): Promise<ProofTrustData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<ProofTrustData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as ProofTrustData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.signers)) throw new Error("Unsupported proof trust registry.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(operation: (data: ProofTrustData) => T | Promise<T>): Promise<T> {
    let output!: T;
    const mutation = this.mutations.then(async () => {
      const data = await this.readSnapshot();
      output = await operation(data);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      await chmod(dirname(this.file), 0o700);
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.file);
      await chmod(this.file, 0o600);
    });
    this.mutations = mutation.then(() => undefined, () => undefined);
    await mutation;
    return output;
  }
}
