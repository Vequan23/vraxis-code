# Signed team policy packs

Vraxis Code can export and import a portable `vraxis.team-policy@1` bundle for consistent approval rules across installations. The bundle is signed by the same local Ed25519 identity used for task proof, but it carries no project data, user credentials, model configuration, or private key material.

## Authority model

A team policy rule targets one approval capability and has one of two effects:

- `ask` ignores matching remembered access and requires a fresh one-time decision.
- `deny` resolves the request as denied before a command, browser action, project write, credential use, or other guarded action begins.

There is deliberately no team-policy `allow`. A portable bundle must never increase an installation's authority or approve an action on the user's behalf. Capabilities not named in the active bundle continue through local remembered decisions and the normal approval flow.

Precedence is:

1. An active team `deny` blocks the action.
2. An active team `ask` requires a fresh decision and disables remembered duration choices.
3. A matching local remembered deny or allow applies.
4. Vraxis Code asks for a one-time decision.

An invalid, expired, or no-longer-trusted installed policy cannot grant access. It forces fresh decisions until the user inspects or removes it.

## Trust and distribution

The policy creator downloads a signed JSON bundle from Settings. Before another installation imports that bundle, its user enrolls the creator's public identity in **Proof identity & trust**. Import verifies:

- the bounded version-1 schema;
- the SHA-256 artifact identity;
- the Ed25519 signature over canonical JSON;
- the issue and optional expiration dates;
- the signer against the local identity or active trusted signer registry.

The installed bundle is stored owner-only. Settings shows the organization, signer, status, and every rule. Approval cards include policy provenance, and the redacted approval-policy audit includes the current team-policy summary.

Vraxis Code does not currently operate a hosted policy control plane. Teams can distribute the signed file through their existing device-management or internal artifact system. Operating-system-enforced installation and removal controls remain future work.

## Local removal

Removing a team policy requires an explicit second confirmation because it can widen local authority by allowing remembered rules to match again. The current local-first product does not claim that a policy is administrator-locked: a user who controls the installation can remove it, and that boundary is visible in the UI and audit model.

The machine-readable contract is published as [`docs/schemas/team-policy.schema.json`](../schemas/team-policy.schema.json).
