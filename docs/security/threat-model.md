# Threat model

## Assets

Vraxis Code protects source files, Git history, runtime credentials, command output, browser state, agent transcripts, approvals, and local persistence.

## Trust boundaries

The renderer is unprivileged. The loopback service is privileged only for registered projects and approved capabilities. Vraxis Desktop owns launch authentication and narrow native integrations. Remote models receive only selected context.

## Initial controls

- Bind the service to `127.0.0.1`.
- Reject non-loopback Host and Origin values.
- Exchange the one-time desktop token exactly once for a random, process-bound HttpOnly, SameSite=Strict cookie that expires after 24 hours. Reject the old static cookie value and invalidate every session when the service exits.
- Issue a separate random SameSite=Strict CSRF cookie and require the matching `x-vraxis-csrf` header on every mutating desktop API request. The renderer adds it centrally; the privileged session secret remains HttpOnly.
- Resolve and validate every project path before access.
- Do not follow a requested path outside its registered root.
- Do not execute command or browser mutations directly from the renderer.
- Keep provider credentials out of renderer responses, logs, and persisted events.
- Persist approval metadata without raw tool inputs; browser typing values remain in memory only until the user decides. Before persistence or policy export, remove URL credentials, query values, fragments, known key formats, bearer tokens, and common secret assignments from approval scopes.
- Keep the cross-harness evidence tool metadata-only: never return raw commands, terminal output, approval scope, project paths, URLs, page content, or credentials through the model-facing evidence index.
- Keep agent-requested verification non-actuating: the model may record one bounded handoff, but it cannot choose a recipe, start a service or command, capture a browser proof, approve an action, or resolve its own request. Only the user-facing product route can bind an accepted handoff to a retained run.
- Run manual terminal commands with `spawn`, an argv tokenizer, `shell: false`, an approved in-workspace cwd, a credential-stripped environment allowlist, a two-minute timeout, process-group interruption where supported, live durable output, and a one-megabyte output limit.
- Run agent browsing in a Vraxis-owned persistent Playwright profile that is isolated from the user's personal browser profile.
- Inject product-owned tools into compatible local harnesses through a loopback-only per-run MCP bridge. Its random token lives only in a mode-0600 temporary descriptor, native workspace access is forced read-only, and unsupported isolation combinations fail closed without writing user or project CLI configuration.
- Route agent terminal commands through the same argv-only runner and product approval lifecycle as manual commands. Approval, running state, bounded output, cancellation, and final status share one receipt id; denial and pre-approval cancellation create no process.
- Restrict browser URLs to HTTP loopback or HTTPS remote origins, require an approval receipt before an agent grants its first origin, accept only current mapped control references for actuation, block downloads, redact network query values, and keep screenshots behind the authenticated loopback service.
- Treat portable browser replay as a separate export boundary: embed retained PNGs and sanitized action metadata into a self-contained document, prohibit external network, form, object, base, and framing authority, and disclose that page pixels can still contain private data.
- Store the local Ed25519 proof private key and rotation history in mode-0700/0600 paths. Rotation generates a distinct key, signs the canonical transition with both old and new identities, retains the old identity for historical proof trust, and never restores a signer the user previously revoked. No private key appears in the attestation, API, UI, support bundle, or exported proof.
- Redact the canonical portable task receipt before hashing and signing, not only its human projection. Remove URL credentials, queries, fragments, authorization values, common provider tokens, secret assignments, and command secret flags while preserving exact raw evidence in authenticated local storage.
- Apply a restrictive response policy to every loopback-service route, including CSP, frame denial, no-referrer, MIME-sniffing protection, cross-origin isolation, and disabled ambient hardware/browser permissions.
- Create product data and imported-attachment directories with owner-only permissions, and imported attachment files with owner read/write permissions, on platforms that support POSIX modes.
- Derive Understand artifacts from the signed receipt but export only bounded paths, evidence identifiers, result states, recipe coverage, rollback metadata, and deterministic prose. Do not copy prompts, activity text, commands, terminal output, approval titles/scopes, browser text/targets, URLs, console messages, network locations, credentials, or model chain-of-thought into the artifact.

## Open work

OS-level command sandboxing, editable browser origin grants, upload policy, schema-aware secret classification beyond bounded pattern redaction, encrypted browser profile storage, storage migration recovery, disk-full recovery, centrally distributed organization trust policy, and expanded security regression coverage must be complete before a public stable release. The current terminal requires an explicit high-risk approval because `shell: false` and an in-workspace cwd do not prevent an approved executable from reading other user-accessible paths. Proof trust enrollment stores only normalized Ed25519 SPKI public keys; revocation removes local trust but intentionally cannot make a previously valid signature mathematically invalid.
