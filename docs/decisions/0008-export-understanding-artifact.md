# 0008: Derive signed understanding from governed evidence

## Context

A complete task proof is useful for audit and replay, but it is deliberately exhaustive. A developer still needs a concise answer to four questions: what changed, which evidence supports it, what remains risky, and what they should understand before owning the result. Asking a model to summarize its own transcript would be non-deterministic, difficult to verify, and likely to copy secrets or hidden reasoning into a new artifact.

## Decision

Vraxis Code derives `vraxis.understand-artifact@1` from an already signed `vraxis.task-proof@1`. Version 1 contains the task and project identity, source-proof artifact and key identifiers, changed-path verification coverage, deterministic evidence-backed claims, retained adverse signals, a governed worktree rollback point, teach-back questions, and typed links back to exact retained evidence.

The artifact carries no raw transcript or runtime output. It omits prompts, activity details, commands, terminal output, approval titles and scopes, browser text and targets, URLs, console messages, network locations, and credentials. Its prose comes from bounded product rules rather than model chain-of-thought. A claim may describe only evidence represented in the source receipt.

The local proof identity signs the canonical artifact payload independently. Verification recomputes its SHA-256 artifact identifier, validates its Ed25519 public-key identity and signature, and checks the task deep link. The artifact records its source proof instead of embedding that much larger envelope.

The workspace exposes Understand beside proof export. Its compact review surface shows verdict, change map, supporting evidence, residual risk, rollback metadata, and teach-back prompts. Explore actions reuse existing evidence navigation and refuse links that are no longer present in retained task state.

## Consequences

- A reviewer gets a portable explanation without trusting opaque model reasoning.
- The same installation identity can sign audit proof and learning artifacts while keeping the private key local.
- Secret minimization is structural rather than dependent on redacting arbitrary output after the fact.
- Version 1 maps changed paths, not symbols, runtime call graphs, or inferred intent. Those require new deterministic evidence before the contract can claim them.
- Aperta and third-party tools may import the public JSON contract only through an explicit user action; no product reads another product's private storage.
