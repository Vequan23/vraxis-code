import { expect, it } from "vitest";
import type { ProjectDoctorSummary, RuntimeSummary, SessionSummary, VerificationRunSummary } from "@vraxis/code-contracts";
import { firstRunReadiness } from "./first-run-readiness.js";

const runtime = (overrides: Partial<RuntimeSummary> = {}): RuntimeSummary => ({
  id: "codex",
  name: "Codex",
  kind: "local-cli",
  availability: "installed",
  authentication: "authenticated",
  acceptsCustomModel: true,
  models: [],
  detail: "Ready",
  conformance: { state: "ready", detail: "Verified", checks: [] },
  ...overrides,
});

const doctor: ProjectDoctorSummary = {
  schemaVersion: 1,
  projectId: "project-1",
  projectName: "Example",
  projectKind: "single-package",
  ecosystems: [{ id: "javascript", label: "JavaScript", manifest: "package.json" }],
  frameworks: [],
  verificationChecks: [{ id: "test", title: "Tests", category: "test", command: "npm", args: ["test"], cwd: ".", required: true, timeoutMs: 60_000, source: "package.json" }],
  devServers: [],
  issues: [],
  ok: true,
};

const session: SessionSummary = {
  id: "session-1",
  projectId: "project-1",
  title: "Understand the project",
  mode: "ask",
  runtimeId: "codex",
  status: "idle",
  updatedAt: "2026-08-31T12:00:00.000Z",
};

it("moves a new installation through runtime, project, task, and proof actions", () => {
  expect(firstRunReadiness({ runtime: runtime({ availability: "missing", conformance: undefined }), sessions: [], verificationRuns: [] }).action.id).toBe("setup-runtime");
  expect(firstRunReadiness({ runtime: runtime({ conformance: { state: "unverified", detail: "Not checked", checks: [] } }), sessions: [], verificationRuns: [] }).action.id).toBe("verify-runtime");
  expect(firstRunReadiness({ runtime: runtime(), sessions: [], verificationRuns: [] }).action.id).toBe("choose-project");
  expect(firstRunReadiness({ runtime: runtime(), project: { id: "project-1", name: "Example", path: "/tmp/example", branch: "main", status: "ready" }, sessions: [], verificationRuns: [] }).action.id).toBe("inspect-project");
  expect(firstRunReadiness({ runtime: runtime(), project: { id: "project-1", name: "Example", path: "/tmp/example", branch: "main", status: "ready" }, projectDoctor: doctor, sessions: [], verificationRuns: [] }).action.id).toBe("draft-task");
});

it("does not claim portable proof until retained verification passes", () => {
  const project = { id: "project-1", name: "Example", path: "/tmp/example", branch: "main", status: "ready" } as const;
  const pending = firstRunReadiness({ runtime: runtime(), project, projectDoctor: doctor, sessions: [session], verificationRuns: [] });
  expect(pending.complete).toBe(false);
  expect(pending.action.id).toBe("review-verification");

  const passed: VerificationRunSummary = {
    id: "verify-1",
    sessionId: session.id,
    projectId: project.id,
    projectName: project.name,
    state: "passed",
    changedPaths: [],
    checks: [],
    services: [],
    browserAssertions: [],
    browserRecommended: false,
    browserState: "not-required",
    recipeFingerprint: "a".repeat(64),
    createdAt: "2026-08-31T12:01:00.000Z",
    completedAt: "2026-08-31T12:02:00.000Z",
  };
  const ready = firstRunReadiness({ runtime: runtime(), project, projectDoctor: doctor, sessions: [session], verificationRuns: [passed] });
  expect(ready.complete).toBe(true);
  expect(ready.completed).toBe(4);
  expect(ready.action.id).toBe("export-proof");
});

it("requires a hosted provider connection test before moving past runtime setup", () => {
  const hosted = runtime({
    kind: "hosted-provider",
    conformance: { state: "unverified", detail: "Not checked", checks: [] },
  });
  expect(firstRunReadiness({ runtime: hosted, sessions: [], verificationRuns: [] }).action.id).toBe("verify-runtime");
});

it("accepts a verified hosted provider as runtime-ready", () => {
  const hosted = runtime({
    kind: "hosted-provider",
    conformance: { state: "ready", detail: "Verified", checks: [] },
  });
  expect(firstRunReadiness({ runtime: hosted, sessions: [], verificationRuns: [] }).action.id).toBe("choose-project");
});
