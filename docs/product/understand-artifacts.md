# Signed Understand artifacts

`vraxis.understand-artifact@1` is Vraxis Code's portable, secret-minimized explanation of a retained task. It answers what changed, which captured evidence supports the verdict, what remains risky, where rollback begins, and what a developer should be able to explain before owning the result.

Use the checked-in [JSON Schema](../schemas/understand-artifact.schema.json) for structural validation. The TypeScript contract is `UnderstandArtifactEnvelopeV1` in `@vraxis/code-contracts`.

## Trust model

An Understand artifact is derived from a signed task proof and records that source proof's artifact and key identifiers. It does not embed the source proof. The local Vraxis Code Ed25519 identity independently signs the canonical Understand payload, so consumers can validate and trust the smaller artifact without treating its prose as model authority.

The artifact intentionally omits:

- user prompts and agent messages;
- commands, terminal output, and environments;
- approval titles, descriptions, and scopes;
- browser text, control targets, URLs, console messages, and network locations;
- credentials and hidden model reasoning.

File paths and bounded evidence identifiers are included because they are the navigation and coverage map. Treat them as potentially sensitive project metadata when sharing an artifact.

## Verification

1. Validate the envelope against the version-1 JSON Schema.
2. Remove only top-level `artifactId` and `integrity`; the remaining object is the signed payload.
3. Canonicalize that payload with `vraxis-json-c14n-v1`: recursively sort object keys lexicographically, preserve array order, omit object properties whose value is `undefined`, and encode the result as UTF-8 JSON without extra whitespace.
4. Compute SHA-256 over those bytes. The lowercase hexadecimal digest must equal `integrity.digest`, and `artifactId` must equal `sha256:<digest>`.
5. Decode `integrity.publicKey` as base64 DER/SPKI. It must be an Ed25519 key. SHA-256 of those DER bytes must equal `integrity.keyId`.
6. Verify the base64 Ed25519 signature over the canonical payload bytes.
7. Evaluate signer trust separately. A valid signature proves integrity and possession of the private key; it does not establish that the signer is trusted by an organization.
8. Resolve the recorded source proof independently when the consuming workflow needs complete raw evidence.

Vraxis Code's reference implementation is `verifyUnderstandArtifact` in `apps/service/src/receipts/understand-artifact.ts`. The canonicalization implementation is in the adjacent `canonical-json.ts` module.

## Evidence semantics

`verified` means every retained changed path is covered by at least one passed governed verification run and no captured failure signal contradicts the result. `partially-verified` means some, but not all, retained changed paths are covered. `unverified` means changes exist without passed coverage. `needs-review` means the receipt includes a failed or interrupted verification or terminal run, a browser/console/network failure, or a conflicted worktree.

These verdicts describe retained evidence only. They are not a claim that uncaptured behavior is correct or safe. The artifact repeats that limitation when it records no contradictory evidence.

## Compatibility

Consumers must reject unknown major artifact versions. Additive contract changes require a new schema and explicit compatibility decision. No consumer should read Vraxis Code or another Vraxis product's private storage; import and source-proof resolution must be explicit user actions.
