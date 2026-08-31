# Vraxis Code

Vraxis Code is a local workspace for giving coding agents a job, watching what they do, and reviewing every change before it reaches your project.

The current vertical slice includes the three-pane workspace, persisted project registration and settings, safe text-file previews, and project-scoped file indexing. Ask, Plan, and Review tasks execute through agent-v with durable ordered events, read-only workspace access, stop, recovery, and resume. Build tasks use a dedicated Git worktree, writable runtime capability checks, a visible branch, a changed-file list, and exact Git patches. Product-owned approvals guard agent tools, terminal commands, browser actuation, verification, and recovery actions. Signed [team policy packs](docs/product/team-policy.md) let trusted installations share ask-or-deny guardrails without granting access remotely. Live PTY output, browser action frames, visible page text, console and credential-redacted network evidence, and retained verification receipts stay attached to the task in one evidence ledger. Browser authentication state is sealed with AES-256-GCM under an operating-system credential-store key instead of living in a reusable plaintext profile. Browser evidence can be exported as a self-contained, network-inert replay with actor and approval provenance. A signed Understand artifact turns the ledger into a changed-path coverage map, evidence-backed verdict, residual-risk list, rollback point, and teach-back prompts without exporting prompts, command output, browser text, URLs, or hidden model reasoning.

## Start the project

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4318`. The web app proxies API calls to the local service at `http://127.0.0.1:4317`.

Run the full project gate:

```bash
npm run check
```

Public macOS releases use a tag-gated, fail-closed signing and notarization workflow. See the [release procedure](docs/product/releasing.md) for required secrets, artifact verification, and the current update-delivery boundary.

Core product states run through automated WCAG 2.0/2.1 A and AA checks in Playwright. The [accessibility quality contract](docs/product/accessibility.md) records automated coverage and the manual assistive-technology checks still required for a stable release.

## Repository map

```text
apps/
  desktop/      Vraxis Desktop manifest and native integration
  service/      local Node service and project access boundary
  web/          Vue renderer and workspace interface
packages/
  contracts/    versioned renderer and service contracts
  test-runtime/ deterministic agent-v runtime for tests
docs/
  decisions/    architecture decision records
  product/      product and interaction contracts
  security/     threat model and permission policy
```

The renderer never receives Node.js, Electron, provider credentials, or unrestricted filesystem access. The local service validates every project path and keeps terminal and browser control behind inspectable capability requests.

## Current cut line

Every live browser session uses an ephemeral context. Cookies, local storage, and IndexedDB are persisted after governed actions as an AES-256-GCM envelope bound to the session identity, while the encryption key remains in the operating-system credential store. Legacy isolated profiles migrate through a network-inert origin hydration and are preserved owner-only for recovery. Exact browser evidence is retained separately and remains sensitive even though it does not grant a live authenticated session.

Build mode creates an isolated baseline from the approved repository's current tracked and non-ignored files, including repositories without a first commit. A runtime must advertise `workspace-write`; hosted agent-v runtimes receive guarded workspace tools, while compatible local harnesses receive the same product tools through agent-v's private per-run MCP bridge and run natively read-only. The bridge exposes a task-scoped `evidence-status` tool so Codex, Claude Code, OpenCode, Cursor, and hosted runtimes can reason about retained approval, terminal, browser, verification, and handoff state without receiving raw commands, output, approval scope, URLs, page content, notes, or credentials. Its `request-verification` tool records a durable handoff only: the user still reviews the exact project-owned recipe and explicitly starts or dismisses it, and every command keeps the normal approval lifecycle. Reviewed changes can be checkpointed, applied, reverted, archived, cleaned up, and restored through the product approval lifecycle without committing the project or changing its index. Scoped approval rules can be remembered for a task or project, while sensitive actions always require a fresh decision. Settings includes a device-level Permission Center for inspecting and revoking durable authority and exporting a redacted active-and-revoked policy audit. Trusted signed team policies layer portable ask-or-deny rules over that local authority, include policy provenance on governed approvals and audits, and require explicit local confirmation before removal. The PTY terminal streams input and output, supports resize and interruption, and preserves a bounded searchable receipt. The isolated Playwright browser lets agents request a first origin through approval, exposes mapped controls instead of arbitrary selectors, blocks downloads, redacts network query values, serializes concurrent actions, and records before/after frames for action replay. Browser state, screenshots, visible text, control maps, console/network evidence, origin grants, and action receipts are atomically retained per task; after restart the UI presents them as saved, non-actuatable evidence until an approved restore refreshes the live control map. Retained action frames can be exported as one offline HTML replay with playback controls, action phase, actor, status, target, and approval identifiers. The export embeds pixels locally, strips secret-bearing metadata, and has no external network, form, object, or framing authority; screenshots can still contain private page content and must be reviewed before sharing.

Project Doctor inspects manifests without executing code, discovers the project's own checks and local browser target, and turns those recipes into approval-gated terminal runs. Repositories that need an exact contract can add a bounded [`.vraxis/verify.json` recipe](docs/product/verification-recipes.md) with governed service startup and loopback health, explicit checks, exact-route and visible-page assertions, and tolerance-based PNG baselines. Verification state and agent handoffs survive restarts, services tear down on every terminal outcome, and a Build is never labeled verified while required proof is missing or captured from the wrong page. Each run carries a stable SHA-256 recipe identity; completed, failed, or interrupted proof can rerun the retained recipe through fresh approvals while preserving lineage and current changed-file scope. Every runtime publishes a product-level preflight matrix for repository reads, isolated Build, governed terminal, controlled browser, skills, model selection, task evidence, and retained verification, so unavailable features are explained before a task starts. Settings separates the registered adapter and host-tool isolation contract from an explicit live conformance probe; the probe makes one bounded provider request, persists its result only for that runtime version, and becomes stale after an update. Runtime install, authentication, and update commands are re-derived by the service and become dedicated approval-gated maintenance tasks with fresh-only authority and retained PTY output instead of untracked shell instructions. Quick Start derives its four steps from those persisted runtime, Project Doctor, task, and verification state, guiding a clean installation toward portable signed proof without a parallel wizard state; an automated end-to-end readiness budget covers the same journey. A task can export a self-verifying Ed25519 JSON proof or printable offline HTML projection with a strict CSP, escaped untrusted content, common credential redaction, and signed `vraxis-code://` links that reopen exact evidence. Secret-bearing URL, authorization, token, environment-assignment, and command-flag values are removed from the canonical receipt before signing, so both JSON and HTML share the same safe export boundary while retained local evidence remains exact. It can also create [`vraxis.understand-artifact@1`](docs/product/understand-artifacts.md), signed by the same installation identity and linked to its source proof, for a smaller deliberately secret-minimized explanation surface. The Proof identity & trust center exports only the installation's public identity, enrolls and revokes external signers, reports signature validity separately from trust, and rotates the local key through an explicit two-step flow that downloads a dual-signed attestation while preserving old-proof verification. Unexpected exits are detected on the next launch and reconciled evidence is disclosed before work resumes. See [the competitive harness plan](docs/product/competitive-harness-plan.md).

See [the foundation decision](docs/decisions/0001-process-boundary.md) and [the product contract](docs/product/workspace.md) for the reasoning behind the first slice.
