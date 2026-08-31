# Competitive open-source harness plan

Research snapshot: August 30, 2026 · implementation audit: August 31, 2026

## Product thesis

Vraxis Code should not compete as another chat wrapper or smaller IDE. It should become the open-source **proof-and-understanding workbench for coding agents**: bring any serious model or harness, let it work in isolation, and leave behind enough evidence that a person can verify the result and understand the code they now own.

The memorable promise is:

> See what the agent saw. Approve what it can do. Understand what it changed.

Provider neutrality is the entry point. Durable evidence and comprehension are the wedge.

## What the market gets right

### OpenCode

OpenCode makes provider breadth feel native. It builds a provider/model catalog from Models.dev, supports connection and custom endpoint overlays, exposes reusable agent profiles, and discovers Agent Skills from OpenCode, Claude-compatible, and `.agents` locations. Its allow/ask/deny permissions cover tools and skills. That combination makes model choice and extensibility feel like infrastructure rather than an afterthought.

Sources: [providers](https://v2.opencode.ai/docs/providers/), [agents](https://opencode.ai/v2/docs/agents), [skills](https://opencode.ai/docs/skills), [tools and permissions](https://dev.opencode.ai/docs/tools/).

### Codex

Codex treats the desktop app as a command center: parallel tasks, built-in worktrees, in-thread diff review, skills, automations, terminals, multiple files, SSH environments, and an in-app browser. Its strongest advantage is one coherent experience across app, CLI, IDE, and cloud, backed by a mature sandbox and approvals model.

Sources: [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/), [Codex for almost everything](https://openai.com/index/codex-for-almost-everything/), [Codex CLI overview](https://help.openai.com/en/articles/11096431).

### T3 Code

T3 Code proves there is strong demand for a polished bring-your-own-subscription control surface. It discovers and drives Codex, Claude, Cursor, Grok, and OpenCode CLIs, separates provider adapters from orchestration, persists a command/event/read-model loop, creates checkpoints, and reaches web, desktop, and mobile clients. Its clarity and distribution are as important as its feature set.

Sources: [project overview](https://github.com/pingdotgg/t3code), [installation and provider discovery](https://github.com/pingdotgg/t3code/blob/main/docs/user/install.md), [provider architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/providers.md), [runtime architecture](https://github.com/pingdotgg/t3code/blob/main/docs/internals/overview.md).

### Claude Code

Claude Code has a deep customization ladder: project instructions, memory, skills, MCP, hooks, plugins, and subagents with separate context and permissions. Its deny/ask/allow rules and hook interception make policy composable. The lesson is not to clone every mechanism; it is to make a small number of extension concepts work consistently at project, user, and team scope.

Sources: [how Claude Code works](https://code.claude.com/docs/en/how-claude-code-works), [permissions](https://code.claude.com/docs/en/permissions), [hooks](https://code.claude.com/docs/en/hooks-guide), [subagents](https://code.claude.com/docs/en/subagents).

### Google Antigravity

Antigravity is the clearest reference for end-to-end visual verification. Agents operate across editor, terminal, and an isolated browser; plans, diffs, diagrams, screenshots, and browser recordings become reviewable Artifacts. Its permission engine separates reading a URL from actuating it and turns approved domains into network boundaries.

Sources: [IDE overview](https://www.antigravity.google/docs/ide/overview/), [browser isolation and recordings](https://antigravity.google/docs/browser?app=antigravity), [unified permissions](https://antigravity.google/docs/permissions/), [artifacts](https://antigravity.google/docs/artifacts).

## What users are asking for

First-party issue trackers show the same needs across products:

- Browser work must be visible and reviewable, not silently unavailable. T3 users specifically ask for a first-class Computer Use approval flow, while Codex and Claude users ask for persistent, screenshot-backed browser workspaces. Sources: [T3 computer-use approval request](https://github.com/pingdotgg/t3code/issues/2156), [Codex browser workspace request](https://github.com/openai/codex/issues/34042), [Claude cloud browser verification request](https://github.com/anthropics/claude-code/issues/75632).
- Users want autonomy inside a narrow boundary, not a choice between prompt fatigue and unlimited authority. Source: [Claude scoped sandbox and approval request](https://github.com/anthropics/claude-code/issues/81121).
- Worktree sessions must remain findable and recoverable after restarts. Sources: [Claude worktree session visibility](https://github.com/anthropics/claude-code/issues/81024), [Codex existing-worktree attachment](https://github.com/openai/codex/issues/34326).
- A harness UI should optimize for status, risk, reviewability, recovery, then raw drill-down. Source: [T3 agent UI discussion](https://github.com/pingdotgg/t3code/issues/511).

These are directional signals, not a quantitative market survey. We should validate them with release telemetry that is opt-in and privacy-preserving, structured GitHub discussions, and five to ten observed onboarding sessions.

## Current Vraxis Code audit

### Already credible

- Provider-neutral runtime execution and discovery through `@vraxis/agent-v`.
- Local CLI harnesses plus direct OpenAI, Anthropic, Google, DeepSeek, Z.ai, OpenRouter, Groq, and compatible endpoints.
- Ask, Plan, Build, and Review with mode-specific default tools and skills.
- Durable projects, tasks, drafts, ordered events, settings, runtime/model selection, attachments, and skill attachment.
- Isolated Build worktrees, exact changed-file evidence, syntax-highlighted file preview, and closeable diffs.
- Approval-backed checkpoint and apply flow that preserves the project index, source commit, and recovery branch.
- One product-owned approval record for agent tools, terminal commands, and browser actions.
- No-shell terminal execution with live bounded output, process-group interruption, explicit working directories, and task-attached receipts.
- An isolated ephemeral Playwright browser context with encrypted authentication-state recovery, approval-gated first-origin navigation, mapped controls, tabs, screenshots, visible-text context, console and credential-redacted network evidence, blocked downloads, bounded waits, and actor-linked action history.
- A concise evidence ledger that makes command, browser, approval, and failure state legible before the user drills into raw output.
- Remembered task/project approval scopes with visible policy rules and fresh decisions for sensitive actions.
- A true PTY terminal with input, resize, interrupt, search, bounded replay, and durable provenance.
- Before/after browser frames and a visual action replay tied to the actor and approval receipt.
- Worktree checkpoint, apply, conflict-safe retry, revert, archive, cleanup, and recovery-branch restore.
- Manifest-only Project Doctor inspection plus approval-gated, durable command and browser verification receipts.
- A pre-task runtime capability disclosure that distinguishes ready, limited, and unavailable product behavior instead of exposing inert controls.
- Canonical JSON receipts plus printable offline HTML proof with secret-pattern redaction and no script, network, form, or framing authority.
- Hosted agent-v runtimes receive guarded workspace and browser tools. Every runtime receives the current browser snapshot as context when one exists.
- Every governed runtime receives the same secret-safe `evidence-status` tool, and the composer discloses task-evidence availability before submission.

### Material gaps

- Codex, Claude Code, stable OpenCode 1.x, and verified Cursor ACP releases receive Vraxis-owned filesystem, terminal, browser, secret-safe evidence, and verification-handoff tools through an authenticated per-run MCP bridge. Native mutation paths are removed or denied, guarded actions use the product approval lifecycle, and terminal calls retain receipts. Unknown OpenCode majors and older Cursor releases fail closed. The handoff is deliberately non-actuating: it records agent intent, while the user reviews and starts or dismisses the product-owned recipe.
- Runtime capability negotiation is explicit and version-aware in the composer. Safe bridge parity is complete for Codex, Claude Code, stable OpenCode 1.x, and verified Cursor ACP releases. Settings separates the registered adapter and host-tool isolation contract from an opt-in bounded live model probe, persists the result by runtime version, and marks it stale after an update.
- Browser frames are retained per action, project recipes can perform tolerance-based visual regression comparison with bounded diff artifacts, and a self-contained offline replay preserves chronological before/after frames, actor, approval, target, and status without network authority. Live contexts are ephemeral; recoverable cookies, local storage, and IndexedDB are encrypted under an operating-system credential-store key, and legacy profiles migrate without network access while remaining preserved for recovery. Lossy video export, upload capability, and frame-level annotation remain future work.
- A dedicated Permission Center now explains active task and project rules across repositories, revokes exact authority, and exports a redacted audit including revoked history. Rule mutation remains revoke-and-reapprove so broader authority cannot appear without a fresh receipt.
- Worktrees support whole-checkpoint, file, and immutable hunk apply. Failed preflight identifies overlapping files and hunks, leaves the project untouched, and supports smaller safe retries; a side-by-side conflict editor remains future work.
- Project Doctor discovers common JavaScript, Python, Rust, and Go checks. Bounded project recipes govern service startup, loopback health, command checks, exact-route and visible-page assertions, screenshot baselines, and teardown. Local Ed25519 proof signs the complete receipt, verification handoff, and exact evidence links. The Proof identity & trust center exports public identity only, enrolls and revokes external signers, distinguishes valid-local, valid-trusted, valid-untrusted, and invalid proofs, and supports local key rotation with a retained dual-signed attestation; centralized organization policy distribution remains future work.
- There is no multi-agent delegation, queue, budget view, or cross-task dependency graph.
- Skills are discoverable and attachable but do not yet produce typed artifacts or quality receipts.
- Quick Start derives a four-step first trusted task from persisted runtime conformance, Project Doctor, task, and verification state. Its complete service journey now has a 15-second regression budget and keyboard/current-step browser coverage. Runtime maintenance commands are dedicated fresh-approval tasks with retained PTY receipts. Packaged desktop smoke runs on macOS, Windows, and Linux CI; unexpected-exit disclosure is implemented. Signed distribution, automatic app updates, privacy-preserving crash reporting, broad accessibility regression, release automation, and public roadmap governance are not release-grade.

## Differentiation: the evidence graph

Every meaningful action should produce a typed, addressable receipt linked to the task:

```text
goal → plan → approval → tool action → raw evidence → change → verification → explanation
```

A receipt answers: who requested it, which runtime/model requested it, what authority was granted, exact scope, what happened, what changed, and what evidence proves the result. The UI presents the concise story first and raw terminal, browser, Git, and file evidence on demand.

This is more useful than a transcript and safer than an opaque autonomous run. It also creates a stable open contract that other Vraxis products and third-party clients can consume.

## Differentiation: understanding mode

Borrow Aperta's learning posture without coupling private storage or product internals. Add an opt-in `Understand` artifact generated from task receipts:

- **Change map:** the files, symbols, dependencies, and runtime paths affected.
- **Why it works:** a short explanation grounded in exact code and verification evidence.
- **Risk map:** assumptions, untested branches, security boundaries, and rollback points.
- **Teach-back:** two or three questions a user can answer to confirm ownership of the change.
- **Explore:** clickable paths that open the relevant code, diff, command, or browser frame.

The artifact must be generated from evidence already captured by Vraxis Code, never from hidden chain-of-thought. Export uses a versioned public artifact contract that Aperta may import with explicit user action.

## Differentiation: the evidence browser

The browser should feel shared by the user and agent, not like a hidden automation process:

1. User or agent requests a domain.
2. Vraxis shows read versus actuation authority separately.
3. The isolated ephemeral context opens the page and records pixels, accessible/visible text, console, and network metadata while its recoverable authentication state remains encrypted at rest.
4. Agent actions are highlighted live and grouped into a replayable receipt.
5. Before external writes—submit, purchase, publish, delete, upload, login—the user sees the exact target and origin again.
6. The completed task links code changes to the browser frame and verification that proved them.

The browser must never silently reuse the user's personal browser profile. A future explicit “control my current tab” connector is a separate capability with separate consent.

## Delivery plan

### Current execution decision

The August 31 audit chose the trustworthy single-agent loop over parallelism or an understanding layer. Tier-one terminal and browser evidence was the prerequisite: a user cannot trust a proof graph if command output appears only at exit or the agent cannot request its first browser origin. That foundation is now implemented together with the first evidence-ledger summary.

The recovery, scoped approval, PTY, durable browser-evidence, portable browser-replay, first verification, secret-minimized offline proof, runtime capability negotiation, governed harness-maintenance, and first signed Understand loops are implemented. The next build sequence is deliberately narrow:

1. Keep Codex, Claude Code, stable OpenCode, and Cursor ACP locked to the shipped adapter conformance contract, version-bound live probe, pre-task capability matrix, official install/auth/update actions, and secret-safe evidence tool.
2. Harden the shipped signed team-policy pack, trusted import, ask-or-deny precedence, approval provenance, audit integration, and explicit local removal; add administrator-locked distribution only with an operating-system enforcement boundary.
3. Harden the shipped deterministic project recipes, including governed service health, route and visible-page assertions, and visual comparison, as part of signed task proof.
4. Harden the shipped Permission Center and team-policy surface with broader accessibility coverage, policy-expiration guidance, and device-management integration without weakening or overstating local authority.
5. Keep the shipped clean-install readiness budget, packaged smoke, unexpected-exit recovery, keyboard/current-step coverage, automated WCAG regression, and fail-closed signed macOS release workflow green; finish manual assistive-technology validation, in-app update delivery, Windows/Linux signing, and privacy-preserving crash reporting before expanding Understand into persistent project memory.
6. Extend the shipped `vraxis.understand-artifact@1` changed-path coverage, retained-risk, rollback, and teach-back surface with symbol/dependency mapping only when those claims can cite deterministic evidence.

Do not begin multi-agent scheduling until one agent can complete, recover, replay, and explain a Build without an unexplained state.

### Milestone 1 — Trustworthy single-agent loop (implemented; hardening remains)

- Finish approval policy rules: deny/ask/allow, editable scope, once/session/project duration, redaction, recovery, and audit export.
- Add PTY terminal sessions with streaming, resize, interrupt, bounded history, and command provenance.
- Add browser tabs, domain grants, element picker, network/console filters, screenshot compare, and action replay.
- Finish worktree apply, checkpoint, revert, archive, and cleanup.
- Current exit status: the complete loop, selective file/hunk apply, conflict-safe retry, visual comparison, and permission export are implemented and covered by service and browser tests; release hardening remains.

### Milestone 2 — Universal harness bridge (implemented; compatibility hardening remains)

- Maintain the shipped secret-safe evidence status and product-owned verification-request handoff; exact capability discovery is disclosed in the composer and adapter tests cover every supported local harness.
- Maintain safe per-harness adapters: Codex, Claude Code, stable OpenCode 1.x, and verified Cursor releases are end-to-end through strict ephemeral MCP or ACP with native mutation paths removed or denied.
- Negotiate capabilities and show unsupported features before a task starts.
- Exit: the same browser and approval flow works for every supported harness, with contract tests per adapter.

### Milestone 3 — Proof and understanding (first artifact implemented)

- Introduce the evidence graph and typed receipts.
- Maintain the shipped signed, source-proof-linked Understand artifact with change coverage, risk map, rollback point, teach-back, in-product exploration, and portable JSON; add an explicit Aperta import/export handshake separately.
- Add verification recipes that require terminal and browser evidence when relevant.
- Exit: every completed Build can answer “what changed, why, what proved it, and what should I learn?”

### Milestone 4 — Parallel and remote work

- Add task queue, multi-agent worktree isolation, budgets, dependencies, notifications, and conflict-aware integration.
- Add secure remote clients after the local trust boundary is mature.
- Exit: multiple agents can work safely without losing attribution, recovery, or evidence.

### Milestone 5 — Open-source launch quality

- One-command install, signed desktop builds, auto-update, crash recovery, sample projects, architecture docs, contributor setup under ten minutes, and public compatibility matrix.
- Publish a weekly 90-second evidence-browser demo and a transparent benchmark: task completion plus human verification time, rollback success, and approval burden.
- Invite extension authors around the evidence contract, skills, and harness adapters.
- Exit: a new user reaches a verified first task in under five minutes and a new contributor lands a tested change in under one hour.

## Taste constraints

- Do not turn the product into a VS Code clone.
- Do not expose capability controls that do nothing.
- Do not hide unsupported provider behavior behind disabled-looking controls.
- Do not show raw event noise before the user can see goal, state, risk, and result.
- Do not claim verification without a linked receipt.
- Do not optimize for autonomous spectacle at the expense of recovery and ownership.
- Prefer a few deeply coherent workflows over a grid of half-working features.

## Buzz and acquisition potential

Attention should come from a demonstrable product primitive, not a slogan. The launch demo should show one agent changing code, asking for a narrowly scoped browser action, proving the UI in an isolated browser, producing an explanation artifact, then replaying and reverting the entire task. The open evidence contract and cross-harness MCP bridge create strategic value beyond the desktop app: they can become infrastructure for model providers, IDEs, education tools, compliance teams, and agent platforms.
