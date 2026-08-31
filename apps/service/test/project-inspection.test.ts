import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProjectDoctorReport } from "@vraxis/agent-v/node";
import { inspectProductReport, verificationChecks } from "../src/verification/project-inspection.js";

function discovered(rootPath: string): ProjectDoctorReport {
  return {
    schemaVersion: 1,
    rootPath,
    projectName: "sample",
    projectKind: "single-package",
    ecosystems: [{ id: "javascript", label: "JavaScript / TypeScript", manifest: "package.json" }],
    frameworks: [],
    verificationChecks: [{
      id: "javascript:test",
      title: "Discovered tests",
      category: "test",
      command: "npm",
      args: ["test"],
      cwd: ".",
      required: true,
      timeoutMs: 60_000,
      source: "package.json#scripts.test",
    }],
    devServers: [{
      id: "javascript:dev",
      title: "Development server",
      command: "npm",
      args: ["run", "dev"],
      cwd: ".",
      suggestedUrl: "http://127.0.0.1:4318/",
      source: "package.json#scripts.dev",
    }],
    issues: [],
    ok: true,
  };
}

async function root(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(directory, ".vraxis"));
  return directory;
}

test("uses a bounded project recipe as the exact verification contract", async () => {
  const directory = await root("vraxis-project-recipe-");
  await mkdir(join(directory, "apps", "web"), { recursive: true });
  await writeFile(join(directory, ".vraxis", "verify.json"), JSON.stringify({
    schemaVersion: 1,
    checks: [{
      id: "web:test",
      title: "Web tests",
      category: "test",
      command: "npm",
      args: ["test", "--workspace", "web"],
      cwd: "apps/web",
      required: true,
      timeoutMs: 90_000,
    }],
    services: [{
      id: "web:dev",
      title: "Web app",
      command: "npm",
      args: ["run", "dev"],
      cwd: "apps/web",
      health: { url: "http://127.0.0.1:4318/health", expectedStatus: 204, timeoutMs: 30_000, intervalMs: 250 },
    }],
    browser: {
      required: true,
      url: "http://localhost:4318/health?proof=1",
      assertions: [
        { id: "route", title: "Review route", kind: "url", value: "http://localhost:4318/health?proof=1" },
        { id: "copy", title: "Ready copy", kind: "text", match: "contains", value: "Ready to ship" },
      ],
      visual: { baseline: "apps/web/test/baselines/review.png", maxDiffRatio: 0.01 },
    },
  }));

  const report = await inspectProductReport(directory, async () => discovered(directory));
  assert.equal(report.verificationSource.kind, "project");
  assert.equal(report.verificationSource.path, ".vraxis/verify.json");
  assert.equal(report.verificationSource.browserTarget, "http://localhost:4318/health?proof=1");
  assert.equal(report.verificationChecks[0]?.id, "web:test");
  assert.equal(report.verificationChecks[0]?.cwd, "apps/web");
  assert.equal(report.verificationServices[0]?.id, "web:dev");
  assert.deepEqual(report.verificationServices[0]?.health, {
    url: "http://127.0.0.1:4318/health",
    expectedStatus: 204,
    timeoutMs: 30_000,
    intervalMs: 250,
  });
  assert.deepEqual(report.verificationBrowserAssertions.map((item) => ({ id: item.id, kind: item.kind, match: item.match, value: item.value })), [
    { id: "route", kind: "url", match: "equals", value: "http://localhost:4318/health?proof=1" },
    { id: "copy", kind: "text", match: "contains", value: "Ready to ship" },
  ]);
  assert.deepEqual(report.verificationVisual, {
    baselinePath: "apps/web/test/baselines/review.png",
    maxDiffRatio: 0.01,
    source: ".vraxis/verify.json",
  });
  assert.ok(report.issues.some((issue) => issue.code === "project-verification-recipe"));
  const plan = verificationChecks(report, ["README.md"]);
  assert.equal(plan.browserRecommended, true);
  assert.equal(plan.browserTarget, "http://localhost:4318/health?proof=1");
  assert.deepEqual(plan.checks.map((check) => check.id), ["web:test"]);
  assert.deepEqual(plan.services.map((service) => service.id), ["web:dev"]);
  assert.deepEqual(plan.browserAssertions.map((assertion) => assertion.id), ["route", "copy"]);
  assert.equal(plan.visual?.baselinePath, "apps/web/test/baselines/review.png");
});

test("falls back to discovered checks when no project recipe exists", async () => {
  const directory = await root("vraxis-discovered-recipe-");
  const report = await inspectProductReport(directory, async () => discovered(directory));
  assert.equal(report.verificationSource.kind, "discovered");
  assert.deepEqual(report.verificationServices, []);
  assert.deepEqual(report.verificationBrowserAssertions, []);
  assert.equal(report.verificationSource.browserTarget, "http://127.0.0.1:4318/");
  assert.deepEqual(report.verificationChecks.map((check) => check.id), ["javascript:test"]);
});

test("rejects ambiguous booleans, unsafe browser targets, and escaping working directories", async () => {
  for (const [name, recipe, expected] of [
    ["required", { schemaVersion: 1, checks: [{ id: "test", command: "npm", required: "false" }] }, /required must be true or false/],
    ["browser", { schemaVersion: 1, checks: [{ id: "test", command: "npm" }], browser: { required: "true" } }, /browser required must be true or false/],
    ["url", { schemaVersion: 1, checks: [{ id: "test", command: "npm" }], browser: { required: true, url: "http://example.com" } }, /Remote verification browser URLs must use HTTPS/],
    ["cwd", { schemaVersion: 1, checks: [{ id: "test", command: "npm", cwd: "../outside" }] }, /must stay inside the project/],
    ["service-url", { schemaVersion: 1, services: [{ id: "web", command: "npm", health: { url: "https://example.com/health" } }] }, /health URLs must use a loopback host/],
    ["assertion-target", { schemaVersion: 1, browser: { required: true, assertions: [{ id: "copy", kind: "text", value: "Ready" }] } }, /assertions require browser.required and an explicit browser.url/],
    ["visual-path", { schemaVersion: 1, browser: { required: true, url: "http://127.0.0.1:4318/", visual: { baseline: "../outside.png" } } }, /must stay inside the project/],
  ] as const) {
    const directory = await root(`vraxis-invalid-${name}-`);
    await writeFile(join(directory, ".vraxis", "verify.json"), JSON.stringify(recipe));
    await assert.rejects(inspectProductReport(directory, async () => discovered(directory)), expected);
  }
});

test("does not follow a verification recipe symlink outside the approved project", async () => {
  const directory = await root("vraxis-symlink-recipe-");
  const outside = await mkdtemp(join(tmpdir(), "vraxis-outside-recipe-"));
  const target = join(outside, "verify.json");
  await writeFile(target, JSON.stringify({ schemaVersion: 1, checks: [{ id: "test", command: "npm" }] }));
  await symlink(target, join(directory, ".vraxis", "verify.json"));
  await assert.rejects(
    inspectProductReport(directory, async () => discovered(directory)),
    /must resolve inside the approved project/,
  );
});
