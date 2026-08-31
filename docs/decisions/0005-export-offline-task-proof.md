# 0005: Export signed, reopenable task proof beside the canonical receipt

Status: accepted

## Context

The versioned JSON task receipt is durable and machine-readable, but it is a poor review artifact for a teammate, security reviewer, or acquisition diligence room. A proof document must summarize the result before raw evidence, remain useful without Vraxis Code running, and treat model output, terminal output, paths, URLs, and approval scopes as untrusted content.

## Decision

Vraxis Code keeps `vraxis.task-receipt@1` as the product evidence contract and wraps it in `vraxis.task-proof@1` for portable integrity. A local Ed25519 identity signs a deterministic `vraxis-json-c14n-v1` payload containing the receipt, its `vraxis-code://task/<id>` link, and optional exact evidence links for changes, terminal receipts, approval decisions, and browser actions. The envelope publishes its SHA-256 artifact identity, digest, signature, public SPKI key, and key identifier; the private PKCS8 key stays in a mode-`0600` file inside a mode-`0700` product data directory. Verifiers continue accepting earlier version-1 envelopes that do not contain evidence links.

The standalone HTML projection is generated from the same signed envelope. It leads with verification verdict and task identity, then shows evidence counts, required services and checks, browser assertions, visual comparison, changed files, authority decisions, terminal receipts, browser actions, and integrity metadata. Linked evidence reopens the owning task, validates the target against its retained state, selects the correct project, and focuses the exact diff, command, authority decision, or browser receipt. Detailed command output uses native disclosures so the default document stays concise and remains printable. Signed JSON is the machine-verifiable portable artifact; HTML is its human-readable projection.

Before hashing and signing, Vraxis Code derives a portable receipt that removes URL credentials, query values, fragments, authorization values, common provider tokens, secret assignments, and command secret flags. Exact raw evidence remains available only through the authenticated local product. Every portable receipt value is HTML escaped in the human projection. The authenticated loopback endpoint returns the document as an attachment with `default-src 'none'`, no base URI, no forms, no framing, no script authority, no external assets, `nosniff`, and `no-store`. Its only link uses the declared `vraxis-code` scheme to reopen the local task.

The interface makes HTML proof the recognizable primary export and keeps JSON adjacent for integrations. Export is a local download and does not transmit evidence to a third party.

## Consequences

- Reviewers can open and print a useful proof without installing Vraxis Code.
- The original receipt endpoint remains backward compatible, while integrations can verify the signed envelope without trusting its transport.
- Pattern redaction reduces accidental leakage in both machine and human proof but cannot prove arbitrary command output contains no sensitive data; the artifact tells users to review it before sharing.
- The signing identity represents one local installation, not a centrally attested human or organization. Enterprise certificate enrollment and trust policy can layer over this contract later.
- Vraxis Desktop owns secure custom-protocol delivery; Vraxis Code validates the task and exact evidence target, selects the associated project, and never reads another product's storage.
