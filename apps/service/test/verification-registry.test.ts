import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  TerminalRunSummary,
  VerificationBrowserAssertionDefinition,
  VerificationCheckDefinition,
  VerificationServiceDefinition,
} from "@vraxis/code-contracts";
import { VerificationRegistry } from "../src/verification/verification-registry.js";

const checks: VerificationCheckDefinition[] = [
  { id: "lint", title: "Lint", category: "lint", command: "npm", args: ["run", "lint"], cwd: ".", required: true, timeoutMs: 30_000, source: "package.json#scripts.lint" },
  { id: "test", title: "Tests", category: "test", command: "npm", args: ["test"], cwd: ".", required: true, timeoutMs: 30_000, source: "package.json#scripts.test" },
];

const service: VerificationServiceDefinition = {
  id: "web:dev",
  title: "Web app",
  command: "npm",
  args: ["run", "dev"],
  cwd: ".",
  health: { url: "http://127.0.0.1:4318/health", expectedStatus: 200, timeoutMs: 30_000, intervalMs: 250 },
  source: ".vraxis/verify.json",
};

const browserAssertion: VerificationBrowserAssertionDefinition = {
  id: "copy",
  title: "Ready copy",
  kind: "text",
  match: "contains",
  value: "Ready to ship",
  caseSensitive: false,
  source: ".vraxis/verify.json",
};

function terminal(id: string, status: TerminalRunSummary["status"]): TerminalRunSummary {
  return { id, sessionId: "session-1", approvalId: `approval-${id}`, command: "npm test", cwd: ".", status, output: status === "success" ? "ok" : "failed" };
}

test("persists a sequential command and browser verification lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-registry-"));
  const registry = new VerificationRegistry(root);
  let run = await registry.create({ sessionId: "session-1", projectId: "project-1", projectName: "sample", changedPaths: ["src/a.ts"], checks, browserRecommended: true });
  run = await registry.awaitApproval(run.id, "lint", "approval-lint");
  run = await registry.startCheck(run.id, "lint", "terminal-lint");
  run = await registry.finishCheck(run.id, "lint", terminal("terminal-lint", "success"));
  assert.equal(run.state, "running");
  run = await registry.awaitApproval(run.id, "test", "approval-test");
  run = await registry.startCheck(run.id, "test", "terminal-test");
  run = await registry.finishCheck(run.id, "test", terminal("terminal-test", "success"));
  assert.equal(run.state, "needs-browser");
  run = await registry.recordBrowser(run.id, "browser-action", 0, 0);
  assert.equal(run.state, "passed");
  assert.equal(run.browserState, "passed");
  assert.equal((await registry.list("session-1"))[0]?.checks.every((item) => item.state === "passed"), true);
});

test("reruns the exact retained recipe with fresh state and stable identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-rerun-"));
  const registry = new VerificationRegistry(root);
  let original = await registry.create({
    sessionId: "session-1",
    projectId: "project-1",
    projectName: "sample",
    changedPaths: ["src/old.ts"],
    checks,
    browserAssertions: [browserAssertion],
    visual: { baselinePath: "test/baselines/review.png", maxDiffRatio: 0.01, source: ".vraxis/verify.json" },
    browserRecommended: true,
    browserTarget: "https://example.com/review",
  });
  assert.match(original.recipeFingerprint, /^[0-9a-f]{64}$/);
  original = await registry.awaitApproval(original.id, "lint", "approval-lint");
  original = await registry.startCheck(original.id, "lint", "terminal-lint");
  original = await registry.finishCheck(original.id, "lint", terminal("terminal-lint", "success"));
  original = await registry.awaitApproval(original.id, "test", "approval-test");
  original = await registry.startCheck(original.id, "test", "terminal-test");
  original = await registry.finishCheck(original.id, "test", terminal("terminal-test", "success"));
  assert.equal(original.state, "needs-browser");
  original = await registry.recordBrowser(
    original.id,
    "browser-action",
    0,
    0,
    [{ id: "copy", passed: true, actual: "Ready to ship" }],
    { passed: true, width: 1_440, height: 900, diffPixels: 0, totalPixels: 1_296_000, diffRatio: 0, diffAvailable: false },
  );
  assert.equal(original.state, "passed");

  const rerun = await registry.rerun(original.id, ["src/new.ts", "src/new.ts"]);
  assert.notEqual(rerun.id, original.id);
  assert.equal(rerun.rerunOfId, original.id);
  assert.equal(rerun.recipeFingerprint, original.recipeFingerprint);
  assert.equal(rerun.browserTarget, "https://example.com/review");
  assert.deepEqual(rerun.browserAssertions.map((item) => ({ id: item.id, state: item.state })), [{ id: "copy", state: "pending" }]);
  assert.deepEqual(rerun.visual, {
    baselinePath: "test/baselines/review.png",
    maxDiffRatio: 0.01,
    source: ".vraxis/verify.json",
    state: "pending",
  });
  assert.deepEqual(rerun.changedPaths, ["src/new.ts"]);
  assert.ok(rerun.checks.every((check) => check.state === "pending" && !check.approvalId && !check.terminalRunId));
  assert.deepEqual(
    rerun.checks.map((check) => ({
      id: check.id,
      title: check.title,
      category: check.category,
      command: check.command,
      args: check.args,
      cwd: check.cwd,
      required: check.required,
      timeoutMs: check.timeoutMs,
      source: check.source,
    })),
    checks,
  );
  await assert.rejects(registry.rerun(original.id, []), /already has an active verification run/);
});

test("fails the run on a denied or unsuccessful required check", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-failed-"));
  const registry = new VerificationRegistry(root);
  let run = await registry.create({ sessionId: "session-1", projectId: "project-1", projectName: "sample", changedPaths: [], checks: [checks[0]!], browserRecommended: false });
  run = await registry.awaitApproval(run.id, "lint", "approval-lint");
  run = await registry.finishCheck(run.id, "lint", terminal("terminal-lint", "interrupted"), "The check was denied.");
  assert.equal(run.state, "failed");
  assert.equal(run.checks[0]?.failure, "The check was denied.");
});

test("retains a governed service health and teardown lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-service-"));
  const registry = new VerificationRegistry(root);
  let run = await registry.create({
    sessionId: "session-1",
    projectId: "project-1",
    projectName: "sample",
    changedPaths: [],
    services: [service],
    checks: [],
    browserRecommended: false,
  });
  run = await registry.awaitServiceApproval(run.id, service.id, "approval-service");
  run = await registry.startService(run.id, service.id, "terminal-service");
  run = await registry.recordServiceHealth(run.id, service.id);
  run = await registry.markServiceHealthy(run.id, service.id, 200);
  assert.equal(run.services[0]?.state, "healthy");
  assert.equal(run.services[0]?.healthAttempts, 2);
  run = await registry.settleIfReady(run.id);
  assert.equal(run.state, "passed");
  run = await registry.markServicesStopped(run.id);
  assert.equal(run.services[0]?.state, "stopped");
  assert.ok(run.services[0]?.stoppedAt);
});

test("marks active verification as interrupted after a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-verification-reconcile-"));
  const registry = new VerificationRegistry(root);
  const created = await registry.create({ sessionId: "session-1", projectId: "project-1", projectName: "sample", changedPaths: [], checks: [checks[0]!], browserRecommended: false });
  await registry.awaitApproval(created.id, "lint", "approval-lint");
  await registry.reconcile();
  const run = await registry.get(created.id);
  assert.equal(run.state, "interrupted");
  assert.equal(run.checks[0]?.state, "failed");
});
