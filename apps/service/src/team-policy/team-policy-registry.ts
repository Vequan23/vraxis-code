import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseCreateTeamPolicyRequest,
  parseTeamPolicyBundle,
  type ApprovalSummary,
  type TeamPolicyBundleV1,
  type TeamPolicyPayloadV1,
  type TeamPolicyState,
} from "@vraxis/code-contracts";
import { canonicalJsonBytes } from "../receipts/canonical-json.js";
import { ProofTrustRegistry } from "../receipts/proof-trust.js";
import { TaskProofSigner, verifySignedPayload } from "../receipts/task-proof.js";

export interface TeamPolicyDecision {
  forceFresh: boolean;
  deny?: string;
  teamPolicy?: NonNullable<ApprovalSummary["teamPolicy"]>;
}

function payload(bundle: TeamPolicyBundleV1): TeamPolicyPayloadV1 {
  return {
    kind: bundle.kind,
    version: bundle.version,
    policyId: bundle.policyId,
    organization: bundle.organization,
    issuedAt: bundle.issuedAt,
    ...(bundle.expiresAt ? { expiresAt: bundle.expiresAt } : {}),
    rules: bundle.rules,
  };
}

export class TeamPolicyRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();

  constructor(
    dataDirectory: string,
    private readonly signer: TaskProofSigner,
    private readonly trust: ProofTrustRegistry,
  ) {
    this.file = join(dataDirectory, "team-policy.json");
  }

  async create(value: unknown): Promise<TeamPolicyBundleV1> {
    const request = parseCreateTeamPolicyRequest(value);
    const issuedAt = new Date().toISOString();
    const unsigned: TeamPolicyPayloadV1 = {
      kind: "vraxis.team-policy",
      version: 1,
      policyId: randomUUID(),
      organization: request.organization,
      issuedAt,
      ...(request.expiresAt ? { expiresAt: request.expiresAt } : {}),
      rules: request.rules.map(({ capability, effect }) => ({
        id: `${capability}:${effect}`,
        capability,
        effect,
        reason: effect === "deny"
          ? `${capability} actions are blocked by ${request.organization} policy.`
          : `${capability} actions require a fresh decision under ${request.organization} policy.`,
      })),
    };
    return { ...unsigned, ...await this.signer.signArtifact(unsigned) };
  }

  async install(value: unknown): Promise<TeamPolicyState> {
    const bundle = parseTeamPolicyBundle(value);
    const issuedAt = Date.parse(bundle.issuedAt);
    if (issuedAt > Date.now() + 5 * 60_000) throw new TypeError("Team policy issue date is in the future.");
    if (bundle.expiresAt && Date.parse(bundle.expiresAt) <= Date.now()) throw new TypeError("Team policy has expired.");
    if (!verifySignedPayload(canonicalJsonBytes(payload(bundle)), bundle.artifactId, bundle.integrity)) {
      throw new TypeError("Team policy signature or digest is invalid.");
    }
    const identity = await this.signer.identity();
    const signer = await this.trust.trustIdentity(bundle.integrity.keyId, bundle.integrity.publicKey, identity);
    if (signer.trust === "untrusted") {
      throw new TypeError("Trust this team policy signer in Proof identity & trust before importing the policy.");
    }
    await this.mutate(async () => this.write(bundle));
    return this.state();
  }

  async state(): Promise<TeamPolicyState> {
    await this.mutations;
    let bundle: TeamPolicyBundleV1 | undefined;
    try { bundle = await this.read(); }
    catch { return { status: "untrusted" }; }
    if (!bundle) return { status: "none" };
    const valid = verifySignedPayload(canonicalJsonBytes(payload(bundle)), bundle.artifactId, bundle.integrity);
    const signer = valid
      ? await this.trust.trustIdentity(bundle.integrity.keyId, bundle.integrity.publicKey, await this.signer.identity())
      : { trust: "untrusted" as const };
    const status = !valid || signer.trust === "untrusted"
      ? "untrusted" as const
      : bundle.expiresAt && Date.parse(bundle.expiresAt) <= Date.now()
        ? "expired" as const
        : "active" as const;
    return {
      status,
      policy: {
        ...payload(bundle),
        artifactId: bundle.artifactId,
        signerKeyId: bundle.integrity.keyId,
        signerLabel: signer.label ?? `Unknown signer ${bundle.integrity.keyId.slice(0, 12)}`,
        status,
      },
    };
  }

  async decision(input: Omit<ApprovalSummary, "id" | "requestedAt" | "state">): Promise<TeamPolicyDecision> {
    const state = await this.state();
    if (!state.policy) return { forceFresh: state.status !== "none" };
    if (state.status !== "active") return { forceFresh: true };
    const rule = state.policy.rules.find((item) => item.capability === input.capability);
    if (!rule) return { forceFresh: false };
    const teamPolicy: NonNullable<ApprovalSummary["teamPolicy"]> = {
      artifactId: state.policy.artifactId,
      policyId: state.policy.policyId,
      organization: state.policy.organization,
      ruleId: rule.id,
      effect: rule.effect,
    };
    return {
      forceFresh: true,
      ...(rule.effect === "deny" ? { deny: rule.reason } : {}),
      teamPolicy,
    };
  }

  async remove(confirmed: boolean): Promise<TeamPolicyState> {
    if (!confirmed) throw new TypeError("Confirm removal of the active team policy.");
    await this.mutate(async () => rm(this.file, { force: true }));
    return { status: "none" };
  }

  private async read(): Promise<TeamPolicyBundleV1 | undefined> {
    try { return parseTeamPolicyBundle(JSON.parse(await readFile(this.file, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const mutation = this.mutations.then(operation);
    this.mutations = mutation.then(() => undefined, () => undefined);
    await mutation;
  }

  private async write(bundle: TeamPolicyBundleV1): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
    await chmod(this.file, 0o600);
  }
}
