import { expect, test } from "@playwright/test";
import type { BrowserSessionSummary } from "@vraxis/code-contracts";
import { renderBrowserReplay } from "../../../service/src/browser/browser-replay.js";

function collectBrowserErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectBasicAccessibility(page: import("@playwright/test").Page): Promise<void> {
  const issues = await page.evaluate(() => {
    const failures: string[] = [];
    const ids = new Map<string, number>();
    for (const element of document.querySelectorAll<HTMLElement>("[id]")) {
      if (!element.id) continue;
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    }
    for (const [id, count] of ids) {
      if (count > 1) failures.push(`duplicate id: ${id} (${count})`);
    }
    const visible = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    };
    for (const element of document.querySelectorAll<HTMLElement>("button,input,select,textarea")) {
      if (!visible(element) || element.getAttribute("aria-hidden") === "true" || element.closest('[aria-hidden="true"]')) continue;
      const labelledBy = element.getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ") ?? "";
      const labels = "labels" in element
        ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? "").join(" ")
        : "";
      const name = [
        element.getAttribute("aria-label"),
        labelledBy,
        labels,
        element.getAttribute("title"),
        element.tagName === "BUTTON" ? element.textContent : "",
      ].filter(Boolean).join(" ").trim();
      if (!name) failures.push(`unnamed ${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""} type=${element.getAttribute("type") ?? ""} class=${element.className} name=${element.getAttribute("name") ?? ""}`);
    }
    return failures;
  });
  expect(issues).toEqual([]);
}

async function routeProofTrust(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/proof/trust", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identity: { keyId: "a".repeat(64), publicKey: "MCowBQYDK2VwAyEAproofidentity", publicKeyFormat: "spki-base64", algorithm: "Ed25519" },
      signers: [],
    }),
  }));
}

test("plays a generated portable browser evidence replay without network authority", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const state: BrowserSessionSummary = {
    sessionId: "session-replay",
    status: "closed",
    url: "https://example.test/result",
    title: "Replay result",
    snapshot: "",
    screenshotVersion: 2,
    viewport: { width: 1280, height: 820 },
    activeTabId: "tab-replay",
    tabs: [],
    controls: [],
    allowedOrigins: ["https://example.test"],
    console: [],
    network: [],
    actions: [{ id: "action-replay", action: "click", target: "Save (e1)", status: "success", timestamp: "2026-08-31T12:00:01.000Z", detail: "Saved the form.", actor: "agent", approvalId: "approval-replay", beforeFrameId: "frame-before", afterFrameId: "frame-after" }],
    frames: [
      { id: "frame-after", actionId: "action-replay", phase: "after", url: "https://example.test/result", title: "Saved", timestamp: "2026-08-31T12:00:02.000Z", screenshotVersion: 2 },
      { id: "frame-before", actionId: "action-replay", phase: "before", url: "https://example.test/form", title: "Form", timestamp: "2026-08-31T12:00:00.000Z", screenshotVersion: 1 },
    ],
    updatedAt: "2026-08-31T12:00:02.000Z",
  };
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const replay = await renderBrowserReplay(state, async () => pixel);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.setContent(replay.html, { waitUntil: "load" });

  await expect(page.getByRole("heading", { name: "Replay result" })).toBeVisible();
  await expect(page.locator("#phase")).toHaveText("before");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("#phase")).toHaveText("after");
  await expect(page.getByText("approval-replay", { exact: true })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Timeline" })).toHaveValue("1");
  await expectBasicAccessibility(page);
  expect(requests.filter((url) => url.startsWith("http"))).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test("gives the empty workspace one primary action", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.goto("/?preview=empty");

  await expect(page.locator(".product-root")).toHaveAttribute("data-osx-theme", "graphite-dark");
  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose project", exact: true })).toBeVisible();
  await expect(page.getByText("Quick start · 1/4 complete")).toBeVisible();
  const currentStep = page.locator('.first-run li[aria-current="step"]');
  await expect(currentStep).toHaveCount(1);
  await expect(currentStep).toContainText("Inspect a project");
  await expect(currentStep).toContainText("Current step");
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveCount(0);
  await expectBasicAccessibility(page);
  await page.screenshot({ path: testInfo.outputPath("empty-workspace.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("starts a task from a selected project and keeps evidence truthful", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.goto("/?preview=project");

  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expect(page.getByText("Quick start · 2/4 complete")).toBeVisible();
  const currentStep = page.locator('.first-run li[aria-current="step"]');
  await expect(currentStep).toHaveCount(1);
  await expect(currentStep).toContainText("Run the first task");
  await page.getByText("Codex CLI capabilities", { exact: true }).click();
  await expect(page.getByText("Governed terminal", { exact: true })).toBeVisible();
  await expect(page.getByText("Retained verification", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Draft the first task" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveValue("Inspect this project and explain its architecture with file-backed evidence.");
  await page.getByRole("radio", { name: "Plan", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Plan" })).toBeChecked();

  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByText("No changes", { exact: true })).toBeVisible();
  await expect(page.getByText("Uncommitted changes")).toHaveCount(0);

  await page.getByRole("tab", { name: "Terminal" }).click();
  await expect(page.getByText("No commands yet", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Browser" }).click();
  await expect(page.getByText("Open a page", { exact: true })).toBeVisible();
  await expectBasicAccessibility(page);
  await page.screenshot({ path: testInfo.outputPath("redesigned-workspace.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("discloses recovery after an unexpected service exit", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "recovered-project", name: "recovered-project", path: "/Users/engineer/recovered-project", branch: "main", status: "ready" };
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 24,
      projects: [project],
      sessions: [],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, kind: "local-cli", models: [], conformance: { state: "ready", detail: "Verified", checks: [] } }],
      modelProviders: [],
      skills: [],
      selectedProjectId: project.id,
      files: [],
      changes: [],
      events: [],
      approvals: [],
      approvalRules: [],
      terminalRuns: [],
      verificationRuns: [],
      projectDoctor: { schemaVersion: 1, projectId: project.id, projectName: project.name, projectKind: "unknown", ecosystems: [], frameworks: [], verificationChecks: [], devServers: [], issues: [], ok: true },
      startupRecovery: { previousUnexpectedExit: true, previousStartedAt: "2026-08-31T09:00:00.000Z", checkedAt: "2026-08-31T10:00:00.000Z" },
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }),
  }));
  await page.goto("/");
  await expect(page.getByText("Recovered after an unexpected exit", { exact: true })).toBeVisible();
  await expect(page.getByText(/Active approvals, terminal runs, verification, and worktree application were reconciled/)).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("keeps project evidence compact and keyboard navigable", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1200, height: 560 });
  await page.goto("/?preview=project");

  const inspector = page.getByRole("complementary", { name: "Project evidence" });
  const filesTab = page.getByRole("tab", { name: "Files" });
  const changesTab = page.getByRole("tab", { name: "Changes" });
  const tablist = page.getByRole("tablist", { name: "Project evidence" });
  const tablistBounds = await tablist.boundingBox();
  expect(tablistBounds?.height).toBeLessThanOrEqual(40);

  await filesTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(changesTab).toBeFocused();
  await expect(changesTab).toHaveAttribute("aria-selected", "true");

  const emptyState = inspector.locator(".evidence-empty");
  await expect(emptyState.getByText("No changes", { exact: true })).toBeVisible();
  const emptyBounds = await emptyState.boundingBox();
  const inspectorBounds = await inspector.boundingBox();
  expect(emptyBounds?.height).toBeLessThanOrEqual(80);
  expect((emptyBounds?.y ?? 0) + (emptyBounds?.height ?? 0)).toBeLessThanOrEqual(
    (inspectorBounds?.y ?? 0) + (inspectorBounds?.height ?? 0),
  );

  await page.screenshot({ path: testInfo.outputPath("compact-project-evidence.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("makes durable authority visible, revocable, and exportable", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-policy", name: "policy-project", path: "/Users/engineer/policy-project", branch: "main", status: "ready" };
  const otherProject = { id: "project-other", name: "other-project", path: "/Users/engineer/other-project", branch: "main", status: "ready" };
  const session = { id: "session-policy", projectId: project.id, title: "Review authority", mode: "ask", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const rules = [
    { id: "rule-allow", projectId: project.id, effect: "allow", duration: "project", capability: "command", source: "terminal", scope: ". · npm run check", createdAt: "2026-08-31T10:00:00.000Z" },
    { id: "rule-deny", projectId: otherProject.id, sessionId: "session-other", effect: "deny", duration: "session", capability: "browser", source: "browser", scope: "https://example.com/review", createdAt: "2026-08-30T10:00:00.000Z" },
  ];
  await routeProofTrust(page);
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 24,
      projects: [project, otherProject], sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [], changes: [], events: [], approvals: [], approvalRules: [], terminalRuns: [], verificationRuns: [],
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }),
  }));
  await page.route(/\/api\/approval-rules$/, async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ rules }),
  }));
  await page.route("**/api/approval-rules/rule-allow", async (route) => {
    rules.splice(rules.findIndex((item) => item.id === "rule-allow"), 1);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rule: { id: "rule-allow", revokedAt: new Date().toISOString() } }) });
  });
  await page.route("**/api/approval-rules/audit", async (route) => route.fulfill({
    status: 200,
    contentType: "application/vnd.vraxis.approval-policy-audit+json",
    headers: { "content-disposition": "attachment; filename=vraxis-code-approval-policy.json" },
    body: JSON.stringify({ kind: "vraxis.approval-policy-audit", version: 1, generatedAt: new Date().toISOString(), summary: { active: 2, revoked: 0, allowed: 1, denied: 1 }, rules }),
  }));

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  const center = page.locator(".permission-center");
  await expect(center.getByRole("heading", { name: "Access & approvals" })).toBeVisible();
  await expect(center.getByText("2", { exact: true }).first()).toBeVisible();
  await expect(center.getByText(". · npm run check", { exact: true })).toBeVisible();
  await expect(center.getByText("other-project · this task", { exact: false })).toBeVisible();

  const auditDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download audit" }).click();
  await expect((await auditDownload).suggestedFilename()).toMatch(/approval-policy-.*\.json$/);

  const allowedRule = page.locator(".permission-rule-list li").filter({ hasText: "npm run check" });
  await allowedRule.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("The next matching action will ask for approval again.")).toBeVisible();
  await expect(page.getByText(". · npm run check", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("permission-center.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("enrolls a proof signer and verifies an exported proof without exposing private keys", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const identity = { keyId: "a".repeat(64), publicKey: "local-public-key", publicKeyFormat: "spki-base64", algorithm: "Ed25519" };
  const signers: Array<Record<string, string>> = [];
  let enrollment: Record<string, string> | undefined;
  await page.route("**/api/proof/trust", async (route) => {
    if (route.request().method() === "POST") {
      enrollment = route.request().postDataJSON() as Record<string, string>;
      signers.unshift({ ...identity, keyId: "b".repeat(64), publicKey: enrollment.publicKey!, label: enrollment.label!, enrolledAt: new Date().toISOString() });
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ signer: signers[0], state: { identity, signers } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity, signers }) });
  });
  await page.route("**/api/proof/trust/*", async (route) => {
    signers[0]!.revokedAt = new Date().toISOString();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signer: signers[0], state: { identity, signers } }) });
  });
  await page.route("**/api/proof/verify", async (route) => {
    expect(route.request().postData()).toContain("vraxis.task-proof");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ signature: "valid", trust: "trusted", keyId: "b".repeat(64), signerLabel: "Release builder", artifactId: `sha256:${"c".repeat(64)}`, detail: "The proof is valid and its signer is enrolled as Release builder." }) });
  });

  await page.goto("/?preview=project");
  await page.getByRole("button", { name: "Settings" }).click();
  const section = page.locator(".proof-trust-settings");
  await expect(section.getByRole("heading", { name: "Proof identity & trust" })).toBeVisible();
  await section.getByRole("textbox", { name: "Identity label" }).fill("Release builder");
  await section.getByRole("textbox", { name: "SPKI public key" }).fill("remote-public-key");
  await section.getByRole("button", { name: "Enroll signer" }).click();
  expect(enrollment).toEqual({ label: "Release builder", publicKey: "remote-public-key" });
  await expect(section.getByText("Release builder", { exact: true })).toBeVisible();
  await section.locator('input[type="file"]').setInputFiles({
    name: "task-proof.json",
    mimeType: "application/vnd.vraxis.task-proof+json",
    buffer: Buffer.from('{"kind":"vraxis.task-proof"}'),
  });
  await expect(section.getByText("Valid, trusted proof", { exact: true })).toBeVisible();
  await expect(section.getByText(/signer is enrolled as Release builder/)).toBeVisible();
  await section.getByRole("button", { name: "Revoke" }).click();
  await expect(section.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(section.getByText("PRIVATE KEY")).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("proof-trust.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("reopens the exact signed-proof evidence target without reloading the task flow", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-evidence", name: "evidence-project", path: "/Users/engineer/evidence-project", branch: "main", status: "ready" };
  const session = { id: "session-evidence", projectId: project.id, title: "Prove the release", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const terminalRun = {
    id: "terminal-evidence",
    sessionId: session.id,
    approvalId: "approval-evidence",
    command: "npm run check",
    cwd: ".",
    status: "success",
    output: "All checks passed.\n",
    durationMs: 842,
    terminalKind: "pty",
    outputVersion: 3,
  };
  let selectionRequests = 0;
  await page.route("**/api/sessions/session-evidence/select", async (route) => {
    selectionRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
  });
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 24,
      projects: [project], sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], capabilities: ["read-only-workspace", "workspace-write", "mcp-tools"] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [], changes: [], events: [], approvals: [], approvalRules: [], terminalRuns: [terminalRun], verificationRuns: [],
      settings: { theme: "graphite-dark", defaultMode: "build", defaultRuntimeId: "codex" },
    }),
  }));

  await page.goto("/?task=session-evidence&evidence=terminal&target=terminal-evidence");
  await expect(page.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Command opened from proof", { exact: true })).toBeVisible();
  await expect(page.locator("#evidence-terminal-terminal-evidence")).toHaveClass(/evidence-target-selected/);
  await expect(page).toHaveURL(/\/$/);
  expect(selectionRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("turns discovered project checks into approved, retained verification proof", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-verify", name: "verified-project", path: "/Users/engineer/verified-project", branch: "main", status: "ready" };
  const session = { id: "session-verify", projectId: project.id, title: "Verify the project", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const doctor = {
    schemaVersion: 1,
    projectId: project.id,
    projectName: project.name,
    projectKind: "workspace",
    packageManager: { id: "npm", name: "npm", lockfile: "package-lock.json" },
    ecosystems: [{ id: "javascript", label: "JavaScript / TypeScript", manifest: "package.json" }],
    frameworks: [{ id: "vite", name: "Vite", ecosystem: "javascript" }, { id: "vue", name: "Vue", ecosystem: "javascript" }],
    verificationChecks: [{ id: "javascript:check", title: "Project check", category: "check", command: "npm", args: ["run", "check"], cwd: ".", required: true, timeoutMs: 900_000, source: "package.json#scripts.check" }],
    verificationServices: [],
    verificationSource: { kind: "project", path: ".vraxis/verify.json", browserRequired: false },
    devServers: [{ id: "javascript:dev", title: "Development server", command: "npm", args: ["run", "dev"], cwd: ".", suggestedUrl: "http://127.0.0.1:4318/", source: "package.json#scripts.dev" }],
    issues: [],
    ok: true,
  };
  const approvals: Array<Record<string, unknown>> = [];
  const terminalRuns: Array<Record<string, unknown>> = [];
  const verificationRuns: Array<Record<string, unknown> & { checks: Array<Record<string, unknown>> }> = [];
  const verificationHandoffs: Array<Record<string, unknown>> = [{
    id: "handoff-verify",
    sessionId: session.id,
    state: "requested",
    requestedAt: new Date().toISOString(),
    requestedBy: { actor: "agent", runtimeId: "codex", modelId: "gpt-5.6" },
    note: "Run the project-owned checks before delivery.",
  }];
  let bootstrapRequests = 0;
  let rerunRequests = 0;
  let handoffStartRequest: Record<string, unknown> | undefined;
  const recipeFingerprint = "7a4c8e9f".padEnd(64, "0");

  await page.route("**/api/bootstrap", async (route) => {
    bootstrapRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      contractVersion: 24,
      projects: [project], sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], capabilities: ["workspace-write"] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [{ path: "src/index.ts" }], changes: [{ path: "src/index.ts", status: "modified" }], events: [], approvals, terminalRuns, verificationRuns, verificationHandoffs, projectDoctor: doctor,
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }) });
  });
  await page.route("**/api/sessions/session-verify/verifications", async (route) => {
    handoffStartRequest = route.request().postDataJSON() as Record<string, unknown>;
    const approval = { id: "approval-verify", sessionId: session.id, projectId: project.id, requestedAt: new Date().toISOString(), capability: "command", title: "Verify · Project check", description: "Run the discovered check command and retain its terminal receipt as proof.", scope: ". · npm run check", risk: "high", state: "pending", source: "terminal" };
    const run = { id: "verification-1", sessionId: session.id, projectId: project.id, projectName: project.name, state: "running", changedPaths: ["src/index.ts"], services: [], checks: [{ ...doctor.verificationChecks[0], state: "awaiting-approval", approvalId: approval.id }], browserRecommended: false, browserState: "not-required", recipeFingerprint, createdAt: new Date().toISOString(), startedAt: new Date().toISOString() };
    approvals.unshift(approval);
    verificationRuns.unshift(run);
    terminalRuns.unshift({ id: "terminal-verify", sessionId: session.id, approvalId: approval.id, command: "npm run check", cwd: ".", status: "pending", output: "" });
    Object.assign(verificationHandoffs[0]!, { state: "accepted", resolvedAt: new Date().toISOString(), verificationRunId: run.id });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ run, approval, handoff: verificationHandoffs[0] }) });
  });
  await page.route("**/api/approvals/approval-verify/decision", async (route) => {
    approvals[0]!.state = "completed";
    Object.assign(terminalRuns[0]!, { status: "success", output: "All checks passed\n", exitCode: 0, durationMs: 2180 });
    Object.assign(verificationRuns[0]!, { state: "passed", completedAt: new Date().toISOString() });
    Object.assign(verificationRuns[0]!.checks[0], { state: "passed", terminalRunId: "terminal-verify", completedAt: new Date().toISOString() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approval: approvals[0] }) });
  });
  await page.route("**/api/verifications/verification-1/rerun", async (route) => {
    rerunRequests += 1;
    const approval = { id: "approval-rerun", sessionId: session.id, projectId: project.id, requestedAt: new Date().toISOString(), capability: "command", title: "Verify · Project check", description: "Run the exact retained recipe with fresh proof.", scope: ". · npm run check", risk: "high", state: "pending", source: "terminal" };
    const run = { id: "verification-2", rerunOfId: "verification-1", sessionId: session.id, projectId: project.id, projectName: project.name, state: "running", changedPaths: ["src/index.ts"], services: [], checks: [{ ...doctor.verificationChecks[0], state: "awaiting-approval", approvalId: approval.id }], browserRecommended: false, browserState: "not-required", recipeFingerprint, createdAt: new Date().toISOString(), startedAt: new Date().toISOString() };
    approvals.unshift(approval);
    verificationRuns.unshift(run);
    terminalRuns.unshift({ id: "terminal-rerun", sessionId: session.id, approvalId: approval.id, command: "npm run check", cwd: ".", status: "pending", output: "" });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ run, approval }) });
  });
  await page.route("**/api/sessions/session-verify/live-evidence", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvals, terminalRuns, verificationRuns, verificationHandoffs }) });
  });
  await page.route("**/api/sessions/session-verify/events?after=*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session, events: [] }) });
  });
  await page.route("**/api/sessions/session-verify/receipt.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "content-disposition": "attachment; filename=verified-project-session-proof.html" },
      body: "<!doctype html><title>Verified proof</title><p>Passed</p>",
    });
  });
  await page.route("**/api/sessions/session-verify/understand.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/vnd.vraxis.understand+json",
      body: JSON.stringify({
        kind: "vraxis.understand-artifact", version: 1, generatedAt: new Date().toISOString(), deepLink: "vraxis-code://task/session-verify",
        sourceProof: { artifactId: `sha256:${"a".repeat(64)}`, keyId: "b".repeat(64) },
        session: { id: session.id, title: session.title, mode: session.mode, runtimeId: session.runtimeId },
        project: { id: project.id, name: project.name, branch: project.branch },
        verdict: { state: "verified", summary: "All 1 changed path is covered by passed governed verification." },
        changes: [{ path: "src/index.ts", status: "modified", coverage: "verified", verificationIds: ["verification-1"] }],
        claims: [{ id: "claim-verification", statement: "1 governed verification run has passed.", evidenceIds: ["verification-1"] }],
        risks: [{ id: "risk-none-retained", severity: "info", title: "No contradictory evidence retained", detail: "No retained failure signal contradicts this verdict.", evidenceIds: ["verification-1"] }],
        teachBack: [{ id: "teach-change", question: "What behavior depends on src/index.ts, and how did this task change it?", evidenceIds: ["change-1"] }],
        evidenceLinks: [
          { id: "change-1", kind: "change", target: "src/index.ts", label: "src/index.ts", deepLink: "vraxis-code://task/session-verify?evidence=change&target=src%2Findex.ts" },
          { id: "verification-1", kind: "verification", target: "verification-1", label: "Verification verificat · passed", deepLink: "vraxis-code://task/session-verify?evidence=verification&target=verification-1" },
        ],
        artifactId: `sha256:${"c".repeat(64)}`,
        integrity: { algorithm: "Ed25519", canonicalization: "vraxis-json-c14n-v1", digestAlgorithm: "SHA-256", digest: "c".repeat(64), signature: "signature", publicKey: "public-key", publicKeyFormat: "spki-base64", keyId: "b".repeat(64) },
      }),
    });
  });
  await page.route("**/api/sessions/session-verify/diff?path=src%2Findex.ts", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      path: "src/index.ts", patch: "@@ -1 +1 @@\n-false\n+true", language: "typescript", additions: 1, deletions: 1, binary: false, partialSelection: true,
      hunks: [{ id: "hunk-1", header: "@@ -1 +1 @@", additions: 1, deletions: 1 }],
    }) });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Verify" }).click();
  await expect(page.getByText("Project Doctor", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Project recipe")).toBeVisible();
  await expect(page.getByText("Project contract · .vraxis/verify.json", { exact: true })).toBeVisible();
  await expect(page.locator(".project-doctor-card").getByLabel("Ready")).toBeVisible();
  await expect(page.getByText("Project check", { exact: true })).toBeVisible();
  await expect(page.getByText("Browser target · http://127.0.0.1:4318/")).toBeVisible();
  await expect(page.getByRole("region", { name: "Agent verification handoff" })).toContainText("codex handed verification back to you");
  await expect(page.getByText("Run the project-owned checks before delivery.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run verification" })).toHaveCount(0);
  await page.getByRole("button", { name: "Start governed verification" }).click();
  expect(handoffStartRequest).toEqual({ handoffId: "handoff-verify" });
  await expect(page.getByText("Verify · Project check", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.locator(".verification-workflow strong").filter({ hasText: /^Passed$/ })).toBeVisible();
  await expect(page.getByLabel("Task evidence ledger")).toContainText("1 verified");
  await page.getByRole("button", { name: "Understand" }).click();
  await expect(page.getByRole("region", { name: "Task understanding" })).toContainText("All 1 changed path is covered");
  await expect(page.getByRole("region", { name: "Task understanding" })).toContainText("Teach it back");
  await page.screenshot({ path: testInfo.outputPath("understand-artifact.png"), fullPage: true });
  await page.getByRole("button", { name: "Explore evidence" }).click();
  await expect(page.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close understanding" }).click();
  await expect(page.getByRole("region", { name: "Task understanding" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Verify" }).click();
  const proofDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download proof" }).click();
  await expect((await proofDownload).suggestedFilename()).toMatch(/proof\.html$/);
  await expect(page.getByText(
    `Recipe ${recipeFingerprint.slice(0, 12)} · 0 services · 1 command receipt · 0 browser assertions`,
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", { name: "Rerun exact recipe" }).click();
  await expect.poll(() => rerunRequests).toBe(1);
  await expect(page.getByText("Verify · Project check", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("verified-delivery-loop.png"), fullPage: true });
  expect(bootstrapRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("shows governed service health and can stop and tear down an active verification", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-service", name: "service-project", path: "/Users/engineer/service-project", branch: "main", status: "ready" };
  const session = { id: "session-service", projectId: project.id, title: "Verify preview", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const service = {
    id: "web:preview",
    title: "Preview server",
    command: "npm",
    args: ["run", "dev"],
    cwd: ".",
    health: { url: "http://127.0.0.1:4318/health", expectedStatus: 200, timeoutMs: 60_000, intervalMs: 500 },
    source: ".vraxis/verify.json",
    state: "healthy",
    approvalId: "approval-service",
    terminalRunId: "terminal-service",
    startedAt: new Date().toISOString(),
    healthyAt: new Date().toISOString(),
    healthAttempts: 2,
    lastHealthStatus: 200,
  };
  const run: Record<string, unknown> & { services: Array<Record<string, unknown>> } = {
    id: "verification-service",
    sessionId: session.id,
    projectId: project.id,
    projectName: project.name,
    state: "needs-browser",
    changedPaths: [],
    services: [service],
    checks: [],
    browserRecommended: true,
    browserState: "pending",
    browserTarget: "http://127.0.0.1:4318/",
    recipeFingerprint: "service-proof".padEnd(64, "0"),
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };
  let stopRequests = 0;
  const liveEvidence = () => ({
    approvals: [{ id: "approval-service", sessionId: session.id, projectId: project.id, requestedAt: new Date().toISOString(), capability: "command", title: "Start service · Preview server", description: "Start preview", scope: ". · npm run dev", risk: "high", state: "completed", source: "terminal" }],
    terminalRuns: [{ id: "terminal-service", sessionId: session.id, approvalId: "approval-service", command: "npm run dev", cwd: ".", status: run.state === "interrupted" ? "interrupted" : "running", output: "ready\n" }],
    verificationRuns: [run],
  });
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 11,
      projects: [project], sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], capabilities: ["workspace-write"] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [], changes: [], events: [], ...liveEvidence(),
      projectDoctor: {
        schemaVersion: 1, projectId: project.id, projectName: project.name, projectKind: "single-package",
        ecosystems: [{ id: "javascript", label: "JavaScript / TypeScript", manifest: "package.json" }], frameworks: [],
        verificationChecks: [], verificationServices: [service], verificationSource: { kind: "project", path: ".vraxis/verify.json", browserRequired: true, browserTarget: "http://127.0.0.1:4318/" },
        devServers: [], issues: [], ok: true,
      },
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }),
  }));
  await page.route("**/api/verifications/verification-service/stop", async (route) => {
    stopRequests += 1;
    run.state = "interrupted";
    Object.assign(run.services[0]!, { state: "stopped", stoppedAt: new Date().toISOString() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run }) });
  });
  await page.route("**/api/sessions/session-service/live-evidence", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(liveEvidence()),
  }));
  await page.route("**/api/sessions/session-service/events?after=*", async (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ session, events: [] }),
  }));

  await page.goto("/");
  await page.getByRole("tab", { name: "Verify" }).click();
  const serviceHealth = page.getByLabel("Governed service health");
  await expect(serviceHealth.getByText("Preview server", { exact: true })).toBeVisible();
  await expect(serviceHealth.getByText(/http:\/\/127\.0\.0\.1:4318\/health · HTTP 200 · 2 attempts/)).toBeVisible();
  await expect(page.getByText("Governed service", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop and tear down" }).click();
  await expect.poll(() => stopRequests).toBe(1);
  await expect(page.locator(".verification-workflow strong").filter({ hasText: /^Interrupted$/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("governed-service-lifecycle.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("shares numbered page controls with the user and agent without selector input", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-browser", name: "browser-project", path: "/Users/engineer/browser-project", branch: "main", status: "ready" };
  const session = { id: "browser-1", projectId: project.id, title: "Verify the page", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const browser = {
    sessionId: session.id,
    status: "ready",
    url: "http://127.0.0.1:3000/",
    title: "Local app",
    snapshot: "Email\nSave",
    screenshotVersion: 3,
    viewport: { width: 1280, height: 820 },
    activeTabId: "tab-1",
    tabs: [
      { id: "tab-1", title: "Local app", url: "http://127.0.0.1:3000/", active: true },
      { id: "tab-2", title: "Docs", url: "https://example.com/docs", active: false },
    ],
    controls: [
      { ref: "e1", kind: "textbox", label: "Email", action: "type", disabled: false, sensitive: false, bounds: { x: 120, y: 140, width: 320, height: 42 } },
      { ref: "e2", kind: "button", label: "Save", action: "click", disabled: false, sensitive: false, bounds: { x: 470, y: 140, width: 90, height: 42 } },
    ],
    allowedOrigins: ["http://127.0.0.1:3000"],
    console: [],
    network: [{ id: "request-1", timestamp: new Date().toISOString(), method: "GET", url: "http://127.0.0.1:3000/api/status?token=%E2%80%A6", resourceType: "fetch", state: "success", status: 200, durationMs: 18 }],
    actions: [{ id: "action-1", action: "capture", target: "active page", status: "success", timestamp: new Date().toISOString(), detail: "Captured 2 controls.", actor: "agent", approvalId: "approval-browser-1", screenshotVersion: 3 }],
    updatedAt: new Date().toISOString(),
  };
  const browserRequests: Array<Record<string, unknown>> = [];
  const approvals: Array<Record<string, unknown>> = [];
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 5,
      projects: [project],
      sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], kind: "local-cli", capabilities: ["workspace-write"] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [], changes: [], events: [], approvals, terminalRuns: [], browser,
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }),
  }));
  await page.route("**/api/browser/browser-1/screenshot?v=*", async (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8cX7wAAAABJRU5ErkJggg==", "base64"),
  }));
  await page.route("**/api/browser/actions", async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    browserRequests.push(request);
    const approval = { id: `approval-${browserRequests.length}`, sessionId: session.id, requestedAt: new Date().toISOString(), capability: "browser", title: `Browser ${request.action}`, description: "Control the isolated browser.", scope: String(request.target ?? request.tabId ?? "active page"), risk: "medium", state: "pending", source: "browser" };
    approvals.unshift(approval);
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ approval }) });
  });
  await page.route("**/api/sessions/browser-1/live-evidence", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ approvals, terminalRuns: [], browser }),
  }));

  await page.goto("/");
  await page.getByRole("tab", { name: "Browser" }).click();
  await expect(page.getByText("Page controls", { exact: true })).toBeVisible();
  await expect(page.getByText("The agent sees the same refs.")).toBeVisible();
  await expect(page.getByLabel("Task evidence ledger")).toContainText("1 browser action");
  await page.getByText("Network · 1").click();
  await expect(page.getByText("GET · fetch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose e1, Email" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Target" })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("shared-browser-controls.png"), fullPage: true });

  await page.getByRole("option", { name: /Email/ }).click();
  await page.getByRole("textbox", { name: "Text to type" }).fill("engineer@example.com");
  await page.getByRole("button", { name: "Type into control" }).click();
  await expect.poll(() => browserRequests[0]?.target).toBe("e1");
  await page.getByRole("button", { name: /Docs/ }).click();
  await expect.poll(() => browserRequests[1]?.tabId).toBe("tab-2");
  expect(browserRequests[1]?.action).toBe("select-tab");
  expect(browserErrors).toEqual([]);
});

test("keeps restart-recovered browser proof visible and stale controls safe until restored", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-retained-browser", name: "retained-browser", path: "/Users/engineer/retained-browser", branch: "main", status: "ready" };
  const session = { id: "session-retained-browser", projectId: project.id, title: "Review saved browser proof", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const browserRequests: Array<Record<string, unknown>> = [];
  const browser = {
    sessionId: session.id,
    status: "closed",
    url: "http://127.0.0.1:3000/",
    title: "Saved preview",
    snapshot: "Email\nSave",
    screenshotVersion: 4,
    viewport: { width: 1280, height: 820 },
    activeTabId: "saved-tab",
    tabs: [{ id: "saved-tab", title: "Saved preview", url: "http://127.0.0.1:3000/", active: true }],
    controls: [{ ref: "e1", kind: "textbox", label: "Email", action: "type", disabled: false, sensitive: false, bounds: { x: 120, y: 140, width: 320, height: 42 } }],
    allowedOrigins: ["http://127.0.0.1:3000"],
    console: [],
    network: [],
    actions: [{ id: "saved-action", action: "capture", target: "active page", status: "success", timestamp: new Date().toISOString(), detail: "Captured before restart.", actor: "agent", screenshotVersion: 4 }],
    frames: [],
    updatedAt: new Date().toISOString(),
  };
  await page.route("**/api/bootstrap", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      contractVersion: 8,
      projects: [project],
      sessions: [session],
      runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], kind: "local-cli", capabilities: ["workspace-write"] }],
      modelProviders: [], skills: [], selectedProjectId: project.id, selectedSessionId: session.id,
      files: [], changes: [], events: [], approvals: [], terminalRuns: [], browser,
      settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
    }),
  }));
  await page.route("**/api/browser/session-retained-browser/screenshot?v=*", async (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8cX7wAAAABJRU5ErkJggg==", "base64"),
  }));
  await page.route("**/api/browser/actions", async (route) => {
    browserRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ approval: { id: "approval-restore", sessionId: session.id, requestedAt: new Date().toISOString(), capability: "browser", title: "Restore browser", description: "Refresh retained browser evidence.", scope: browser.url, risk: "medium", state: "pending", source: "browser" } }),
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Browser" }).click();
  await expect(page.getByText("Saved evidence", { exact: true })).toBeVisible();
  await expect(page.getByText("Retained viewport", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved control map. Restore the browser before acting.", { exact: true })).toBeVisible();
  await expect(page.getByAltText("Captured page Saved preview")).toBeVisible();
  await page.getByRole("option", { name: /Email/ }).click();
  await expect(page.getByRole("button", { name: "Type into control" })).toBeDisabled();
  await page.getByRole("button", { name: "Restore browser" }).click();
  await expect.poll(() => browserRequests[0]?.action).toBe("capture");
  await page.screenshot({ path: testInfo.outputPath("retained-browser-evidence.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("runs the selected mode and model without reloading the workspace", async ({ page }) => {
  const browserErrors = collectBrowserErrors(page);
  const project = {
    id: "project-1",
    name: "example-project",
    path: "/Users/engineer/example-project",
    branch: "main",
    status: "ready" as const,
  };
  const session = {
    id: "session-1",
    projectId: project.id,
    title: "Where is the entry point?",
    mode: "ask" as "ask" | "plan" | "build" | "review",
    runtimeId: "codex",
    modelId: undefined as string | undefined,
    updatedAt: new Date().toISOString(),
    status: "running" as "running" | "idle",
  };
  const events: Array<Record<string, unknown>> = [
    { id: "event-1", sessionId: session.id, sequence: 1, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "message", title: "Where is the entry point?", detail: "", state: "complete", actor: "user" },
    { id: "event-2", sessionId: session.id, sequence: 2, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "lifecycle", title: "Agent started", detail: "Connecting with read-only access.", state: "running", actor: "system" },
  ];
  let created = false;
  let bootstrapRequests = 0;
  let eventPolls = 0;
  let submittedMode = "";
  let importedFiles = 0;
  let submittedAttachments: Array<{ id: string; name: string; path: string; source?: string }> = [];
  let submittedSkillIds: string[] = [];
  let submittedConsent: { attachmentIds: string[]; runtimeId: string; modelId?: string; confirmed: boolean } | undefined;

  await page.route("**/api/bootstrap", async (route) => {
    bootstrapRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: 1,
        projects: [project],
        sessions: created ? [session] : [],
        runtimes: [{
          id: "codex",
          name: "Codex CLI",
          availability: "installed",
          detail: "Ready",
          acceptsCustomModel: true,
          models: [
            { id: "gpt-5.6-sol", name: "GPT-5.6-Sol", availability: "available", isDefault: true },
            { id: "gpt-5.6-terra", name: "GPT-5.6-Terra", availability: "available" },
          ],
          capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "artifacts"],
        }],
        modelProviders: [],
        skills: [{
          id: "skill-ux",
          name: "ux-fundamentals",
          description: "Product UX guidance for clear interaction flows.",
          version: "1.2.0",
          scopes: ["user"],
          runtimes: ["codex", "cursor"],
        }],
        selectedProjectId: project.id,
        ...(created ? { selectedSessionId: session.id } : {}),
        files: [{ path: "src/index.ts" }],
        changes: [],
        events: created ? events : [],
        settings: { theme: "panther", defaultMode: "ask", defaultRuntimeId: "codex", runtimeModels: { codex: "gpt-5.6-sol" } },
      }),
    });
  });
  await page.route("**/api/attachments", async (route) => {
    importedFiles += 1;
    const storageId = `00000000-0000-0000-0000-${String(importedFiles).padStart(12, "0")}`;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: `imported-file:${storageId}`,
        name: decodeURIComponent(route.request().headers()["x-vraxis-file-name"] ?? "file"),
        path: storageId,
        source: "imported",
        mediaType: route.request().headers()["content-type"],
        size: route.request().postDataBuffer()?.byteLength ?? 0,
      }),
    });
  });
  await page.route(/\/api\/sessions$/, async (route) => {
    const request = route.request().postDataJSON() as {
      runtimeId: string;
      mode: string;
      modelId?: string;
      attachments?: Array<{ id: string; name: string; path: string; source?: string }>;
      skillIds?: string[];
      attachmentConsent?: { attachmentIds: string[]; runtimeId: string; modelId?: string; confirmed: boolean };
    };
    session.runtimeId = request.runtimeId;
    session.mode = request.mode as typeof session.mode;
    submittedMode = request.mode;
    session.modelId = request.modelId;
    submittedAttachments = request.attachments ?? [];
    submittedSkillIds = request.skillIds ?? [];
    events[0] = { ...events[0], skills: submittedSkillIds.map((id) => ({ id, name: "ux-fundamentals", version: "1.2.0" })) };
    submittedConsent = request.attachmentConsent;
    created = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...session, events }) });
  });
  await page.route("**/api/sessions/session-1/events?after=*", async (route) => {
    eventPolls += 1;
    if (eventPolls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session,
          events: [{ id: "event-3", sessionId: session.id, sequence: 3, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "progress", title: "Reading the project", detail: "Gathering repository evidence.", state: "running", actor: "system" }],
        }),
      });
      return;
    }
    session.status = "idle";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session,
        events: [
          { id: "event-4", sessionId: session.id, sequence: 4, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "message", title: "The entry point is `src/index.ts`.", detail: "", state: "complete", actor: "agent" },
          { id: "event-5", sessionId: session.id, sequence: 5, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "lifecycle", title: "Task complete", detail: "Evidence: src/index.ts", state: "complete", actor: "system" },
        ],
      }),
    });
  });
  await page.route("**/api/projects/project-1/file?path=*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ path: "src/index.ts", content: "export const ready = true;\n", language: "typescript", truncated: false }) });
  });

  await page.goto("/");
  await expect(page.getByLabel("Runtime")).toHaveValue("codex");
  await page.getByRole("radio", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "GPT-5.6-Sol", exact: true }).click();
  await page.getByRole("option", { name: /GPT-5.6-Terra/ }).click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add attachment" }).click();
  await (await fileChooser).setFiles([
    { name: "index.ts", mimeType: "text/typescript", buffer: Buffer.from("export const first = true;\n") },
    { name: "index.ts", mimeType: "text/typescript", buffer: Buffer.from("export const second = true;\n") },
  ]);
  await expect(page.getByLabel("Prompt context").getByText("index.ts", { exact: true })).toHaveCount(2);
  const composer = page.getByRole("textbox", { name: "Message to agent" });
  await composer.fill("$ux");
  await page.getByRole("option", { name: /ux-fundamentals/ }).click();
  await expect(page.getByLabel("Prompt context").getByText("ux-fundamentals", { exact: true })).toBeVisible();
  await composer.fill("Where is the entry point?");
  await page.getByRole("button", { name: "Send message" }).click();
  const handoff = page.getByRole("dialog", { name: "Send external files?" });
  await expect(handoff).toBeVisible();
  await expect(page.getByRole("list", { name: "External files to send" }).getByRole("listitem")).toHaveCount(2);
  await expect(handoff).toContainText("Codex CLI · gpt-5.6-terra");
  expect(submittedMode).toBe("");
  await handoff.getByRole("button", { name: "Send files" }).click();
  await expect(handoff).toHaveCount(0);
  await expect.poll(() => submittedMode).toBe("plan");
  expect(submittedMode).toBe("plan");
  expect(session.modelId).toBe("gpt-5.6-terra");
  expect(bootstrapRequests).toBe(1);
  expect(submittedAttachments).toHaveLength(2);
  expect(submittedAttachments.map((item) => item.name)).toEqual(["index.ts", "index.ts"]);
  expect(new Set(submittedAttachments.map((item) => item.id)).size).toBe(2);
  expect(submittedAttachments.every((item) => item.source === "imported")).toBe(true);
  expect(submittedSkillIds).toEqual(["skill-ux"]);
  expect(submittedConsent).toEqual({
    attachmentIds: submittedAttachments.map((item) => item.id),
    runtimeId: "codex",
    modelId: "gpt-5.6-terra",
    confirmed: true,
  });
  await expect(page.getByText("Agent is working", { exact: true })).toBeVisible();
  await expect(page.getByText("Reading the project")).toBeVisible();
  await expect(page.getByText("The entry point is")).toBeVisible();
  await expect(page.getByLabel("Attached context").getByText("ux-fundamentals", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Prompt context")).toHaveCount(0);
  await expect(page.locator(".session-note").filter({ hasText: "Task complete" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test("starts Build in an isolated worktree and opens a closable exact diff", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = {
    id: "project-build",
    name: "build-project",
    path: "/Users/engineer/build-project",
    branch: "main",
    status: "ready",
  };
  const worktree = {
    id: "worktree-1",
    path: "/Users/engineer/.vraxis/code/worktrees/project-build/worktree-1",
    branch: "vraxis/add-health-check-12345678",
    baseBranch: "main",
    baseCommit: "abcdef1234567890",
    status: "active",
  };
  const session = {
    id: "build-1",
    projectId: project.id,
    title: "Add a health check",
    mode: "build",
    runtimeId: "codex",
    updatedAt: new Date().toISOString(),
    status: "running" as "running" | "idle",
    worktree,
  };
  let created = false;
  let polls = 0;
  let submittedMode = "";
  let applied = false;
  let bootstrapRequests = 0;
  const approvals: Array<Record<string, unknown>> = [];
  const initialEvents = [
    { id: "build-event-1", sessionId: session.id, sequence: 1, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "message", title: "Add a health check", detail: "", state: "complete", actor: "user" },
    { id: "build-event-2", sessionId: session.id, sequence: 2, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "lifecycle", title: "Agent started", detail: "Connecting to the isolated worktree.", state: "running", actor: "system" },
  ];

  await page.route("**/api/bootstrap", async (route) => {
    bootstrapRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: 3,
        projects: [project],
        sessions: created ? [session] : [],
        runtimes: [{
          id: "codex",
          name: "Codex CLI",
          availability: "installed",
          detail: "Ready",
          acceptsCustomModel: true,
          models: [],
          kind: "local-cli",
          capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "artifacts"],
        }],
        modelProviders: [],
        skills: [],
        selectedProjectId: project.id,
        ...(created ? { selectedSessionId: session.id } : {}),
        files: [{ path: "src/index.ts" }],
        changes: [],
        events: created ? initialEvents : [],
        approvals,
        terminalRuns: [],
        settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
      }),
    });
  });
  await page.route(/\/api\/sessions$/, async (route) => {
    const request = route.request().postDataJSON() as { mode: string };
    submittedMode = request.mode;
    created = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...session, events: initialEvents }) });
  });
  await page.route("**/api/sessions/build-1/events?after=*", async (route) => {
    polls += 1;
    if (polls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session,
          events: [{ id: "build-event-3", sessionId: session.id, sequence: 3, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "progress", title: "Implementing the task", detail: "Editing the isolated worktree.", state: "running", actor: "system" }],
        }),
      });
      return;
    }
    session.status = "idle";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session,
        events: [
          { id: "build-event-4", sessionId: session.id, sequence: 4, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "message", title: "Added the health check in `src/index.ts`.", detail: "", state: "complete", actor: "agent" },
          { id: "build-event-5", sessionId: session.id, sequence: 5, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "lifecycle", title: "Task complete", detail: "Evidence: src/index.ts", state: "complete", actor: "system" },
          ...(applied ? [{ id: "build-event-6", sessionId: session.id, sequence: 6, timestamp: new Date().toISOString(), runtimeId: "codex", kind: "lifecycle", title: "Changes applied", detail: "1 file was applied to the approved project.", state: "complete", actor: "system" }] : []),
        ],
      }),
    });
  });
  await page.route("**/api/sessions/build-1/live-evidence", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvals, terminalRuns: [] }) });
  });
  await page.route("**/api/sessions/build-1/worktree/apply", async (route) => {
    approvals.unshift({
      id: "approval-apply",
      sessionId: session.id,
      requestedAt: new Date().toISOString(),
      capability: "write",
      title: "Apply Build changes",
      description: "Checkpoint the isolated branch, then apply these reviewed changes to the approved project without committing them.",
      scope: "1 file → /Users/engineer/build-project",
      risk: "high",
      state: "pending",
      source: "worktree",
    });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ approval: approvals[0] }) });
  });
  await page.route("**/api/approvals/approval-apply/decision", async (route) => {
    approvals[0]!.state = "completed";
    applied = true;
    Object.assign(worktree, { status: "applied", checkpointCommit: "1234567890abcdef", appliedAt: new Date().toISOString() });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approval: approvals[0] }) });
  });
  await page.route("**/api/sessions/build-1/workspace", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        worktree,
        files: [{ path: "src/index.ts", status: "modified" }],
        changes: [{ path: "src/index.ts", status: "modified" }],
      }),
    });
  });
  await page.route("**/api/sessions/build-1/diff?path=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        path: "src/index.ts",
        patch: "diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1,2 @@\n export const ready = true;\n+export const health = 'ok';\n",
        language: "typescript",
        additions: 1,
        deletions: 0,
        binary: false,
        partialSelection: true,
        hunks: [{ id: "health-hunk", header: "@@ -1 +1,2 @@", additions: 1, deletions: 0 }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("radio", { name: "Build", exact: true }).click();
  await expect(page.getByText("Build uses an isolated worktree")).toBeVisible();
  await page.getByRole("textbox", { name: "Message to agent" }).fill("Add a health check");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => submittedMode).toBe("build");
  await expect(page.getByText("vraxis/add-health-check-12345678", { exact: true })).toBeVisible();
  await expect(page.getByText("Worktree", { exact: true })).toBeVisible();
  await expect(page.getByText("Added the health check in")).toBeVisible();

  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByRole("region", { name: "Change diff" })).toHaveCount(0);
  await expect(page.getByText("1 file changed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply changes" })).toBeVisible();
  const changedFile = page.getByRole("button", { name: "src/index.ts modified" });
  const changedFileBounds = await changedFile.boundingBox();
  expect(changedFileBounds?.height).toBeLessThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath("compact-change-list.png"), fullPage: true });
  await changedFile.click();
  await expect(page.getByRole("region", { name: "Change diff" })).toBeVisible();
  await expect(page.getByLabel("Diff for src/index.ts")).toBeVisible();
  await expect(page.locator(".diff-preview > header").getByText("+1 −0", { exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Apply exact hunks" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select hunk 1" }).check();
  await expect(page.getByRole("button", { name: "Apply 1 hunk" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("selective-hunk-review.png"), fullPage: true });
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "Apply 0 hunks" })).toBeDisabled();
  await page.getByRole("button", { name: "Close change diff" }).click();
  await expect(page.getByRole("region", { name: "Change diff" })).toHaveCount(0);
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("Apply Build changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByText("Changes applied", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Review", exact: true })).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("applied-build.png"), fullPage: true });
  expect(bootstrapRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("scrolls long file previews inside the Files pane", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  await page.setViewportSize({ width: 1600, height: 720 });
  await page.goto("/?preview=project");
  const preview = page.locator('[aria-label="File preview"] pre');
  const firstTreeName = page.locator(".tree-name").first();
  await expect(firstTreeName).toBeVisible();
  expect(await firstTreeName.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("400");
  await expect(page.getByLabel("File preview")).toHaveCount(0);
  await page.locator('.tree-row[title="apps/service/src/http/app.ts"]').click();
  await expect(preview).toBeVisible();
  await expect(preview.locator(".hljs-keyword").first()).toBeVisible();
  await expect(preview.locator(".hljs-string").first()).toBeVisible();
  const inspectorBounds = await page.getByRole("complementary", { name: "Project evidence" }).boundingBox();
  const previewBounds = await page.locator('[aria-label="File preview"]').boundingBox();
  const treeBounds = await page.locator(".file-tree-region").boundingBox();
  expect(inspectorBounds).not.toBeNull();
  expect(previewBounds).not.toBeNull();
  expect(treeBounds).not.toBeNull();
  expect(previewBounds?.x ?? 0).toBeLessThan(treeBounds?.x ?? 0);
  expect(Math.abs((previewBounds?.y ?? 0) - (treeBounds?.y ?? 0))).toBeLessThanOrEqual(2);
  await expect(page.locator(".line-number").first()).toHaveText("1");
  expect((previewBounds?.y ?? 0) + (previewBounds?.height ?? 0)).toBeLessThanOrEqual(
    (inspectorBounds?.y ?? 0) + (inspectorBounds?.height ?? 0),
  );
  const before = await preview.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
  await preview.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close file preview" }).click();
  await expect(page.getByLabel("File preview")).toHaveCount(0);
  await expect(page.getByRole("tree", { name: "Project files" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("scrollable-file-preview.png"), fullPage: true });
  expect(browserErrors).toEqual([]);
});

test("approves terminal and browser actions without reloading the workspace", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  const project = { id: "project-live", name: "live-project", path: "/Users/engineer/live-project", branch: "main", status: "ready" };
  const session = { id: "session-live", projectId: project.id, title: "Verify the app", mode: "build", runtimeId: "codex", updatedAt: new Date().toISOString(), status: "idle" };
  const approvals: Array<Record<string, unknown>> = [];
  const terminalRuns: Array<Record<string, unknown>> = [];
  let browser: Record<string, unknown> | undefined;
  let bootstrapRequests = 0;
  let nextApprovalSource = "";

  await page.route("**/api/bootstrap", async (route) => {
    bootstrapRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        contractVersion: 5,
        projects: [project],
        sessions: [session],
        runtimes: [{ id: "codex", name: "Codex CLI", availability: "installed", detail: "Ready", acceptsCustomModel: true, models: [], capabilities: ["workspace-write"] }],
        modelProviders: [],
        skills: [],
        selectedProjectId: project.id,
        selectedSessionId: session.id,
        files: [{ path: "src/index.ts" }],
        changes: [],
        events: [],
        approvals,
        terminalRuns,
        ...(browser ? { browser } : {}),
        settings: { theme: "graphite-dark", defaultMode: "ask", defaultRuntimeId: "codex" },
      }),
    });
  });
  await page.route("**/api/commands", async (route) => {
    nextApprovalSource = "terminal";
    approvals.unshift({ id: "approval-terminal", sessionId: session.id, requestedAt: new Date().toISOString(), capability: "command", title: "Run npm test", description: "Run without a shell.", scope: ". · npm test", risk: "high", state: "pending", source: "terminal" });
    terminalRuns.unshift({ id: "run-1", sessionId: session.id, approvalId: "approval-terminal", command: "npm test", cwd: ".", status: "pending", output: "" });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ approval: approvals[0], run: terminalRuns[0] }) });
  });
  await page.route("**/api/browser/actions", async (route) => {
    nextApprovalSource = "browser";
    approvals.unshift({ id: "approval-browser", sessionId: session.id, requestedAt: new Date().toISOString(), capability: "browser", title: "Browser navigate", description: "Open an isolated browser.", scope: "http://127.0.0.1:4318/", risk: "high", state: "pending", source: "browser" });
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ approval: approvals[0] }) });
  });
  await page.route("**/api/approvals/*/decision", async (route) => {
    const selected = approvals.find((item) => item.state === "pending");
    if (selected) selected.state = "completed";
    if (nextApprovalSource === "terminal") {
      Object.assign(terminalRuns[0]!, { status: "success", output: "all tests passed\n", exitCode: 0, durationMs: 321 });
    } else {
      browser = {
        sessionId: session.id,
        status: "ready",
        url: "http://127.0.0.1:4318/",
        title: "Vraxis preview",
        snapshot: "What should we build?",
        screenshotVersion: 1,
        viewport: { width: 1280, height: 820 },
        activeTabId: "tab-preview",
        tabs: [{ id: "tab-preview", title: "Vraxis preview", url: "http://127.0.0.1:4318/", active: true }],
        controls: [],
        allowedOrigins: ["http://127.0.0.1:4318"],
        console: [],
        network: [],
        actions: [{ id: "browser-action-1", action: "navigate", target: "http://127.0.0.1:4318/", status: "success", timestamp: new Date().toISOString(), detail: "Opened the preview.", actor: "user", afterFrameId: "frame-after" }],
        frames: [{ id: "frame-after", actionId: "browser-action-1", phase: "after", url: "http://127.0.0.1:4318/", title: "Vraxis preview", timestamp: new Date().toISOString(), screenshotVersion: 1 }],
        updatedAt: new Date().toISOString(),
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approval: selected }) });
  });
  await page.route("**/api/sessions/session-live/live-evidence", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approvals, terminalRuns, ...(browser ? { browser } : {}) }) });
  });
  await page.route("**/api/browser/session-live/screenshot?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  });
  await page.route("**/api/browser/session-live/frames/frame-after", async (route) => {
    await route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  });
  await page.route("**/api/sessions/session-live/browser-replay.html", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      headers: { "content-disposition": 'attachment; filename="vraxis-session-browser-replay.html"' },
      body: "<!doctype html><title>Portable browser evidence</title>",
    });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "Terminal" }).click();
  await page.getByLabel("Command").fill("npm test");
  await page.getByRole("button", { name: "Request run" }).click();
  await expect(page.getByText("Action needs your approval")).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByText("all tests passed")).toBeVisible();

  await page.getByRole("tab", { name: "Browser" }).click();
  await page.getByLabel("Address").fill("http://127.0.0.1:4318/");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("Action needs your approval")).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByRole("button", { name: "Vraxis preview", exact: true })).toBeVisible();
  await expect(page.getByAltText("Captured page Vraxis preview")).toBeVisible();
  const replayDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export replay" }).click();
  expect((await replayDownload).suggestedFilename()).toMatch(/browser-replay\.html$/);
  await page.screenshot({ path: testInfo.outputPath("approval-browser-terminal.png"), fullPage: true });
  expect(bootstrapRequests).toBe(1);
  expect(browserErrors).toEqual([]);
});

test("uses the local service chooser instead of asking for a path", async ({ page }) => {
  await page.route("**/api/projects/pick-folder", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cancelled: false,
        project: {
          id: "selected-project",
          name: "selected-project",
          path: "/Users/engineer/selected-project",
          branch: "main",
          status: "ready",
        },
      }),
    });
  });
  await page.goto("/?preview=empty");
  await page.getByRole("button", { name: "Choose project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run Project Doctor" })).toBeVisible();
  await expect(page.getByText("Folder path")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
});

test("saves runtime and model defaults in a dedicated settings surface", async ({ page }, testInfo) => {
  const browserErrors = collectBrowserErrors(page);
  let connectedProvider: Record<string, string> | undefined;
  let runtimeProbe: Record<string, unknown> | undefined;
  let maintenanceRequest: Record<string, string> | undefined;
  let rotationRequest: Record<string, unknown> | undefined;
  const settingsState: {
    theme: string;
    defaultMode: string;
    defaultRuntimeId: string;
    runtimeModels?: Record<string, string>;
    disabledRuntimeIds?: string[];
  } = { theme: "panther", defaultMode: "ask", defaultRuntimeId: "codex" };
  await routeProofTrust(page);
  await page.route("**/api/proof/rotate", async (route) => {
    rotationRequest = route.request().postDataJSON() as Record<string, unknown>;
    const previousKeyId = "a".repeat(64);
    const nextKeyId = "b".repeat(64);
    const rotatedAt = "2026-08-31T13:00:00.000Z";
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        state: {
          identity: { keyId: nextKeyId, publicKey: "next-public-key", publicKeyFormat: "spki-base64", algorithm: "Ed25519" },
          signers: [{ keyId: previousKeyId, publicKey: "previous-public-key", publicKeyFormat: "spki-base64", algorithm: "Ed25519", label: "This installation · retired 2026-08-31", enrolledAt: rotatedAt }],
          rotations: [{ artifactId: `sha256:${"c".repeat(64)}`, rotatedAt, previousKeyId, nextKeyId }],
        },
        attestation: {
          kind: "vraxis.proof-key-rotation",
          version: 1,
          rotatedAt,
          previousIdentity: { keyId: previousKeyId, publicKey: "previous-public-key", publicKeyFormat: "spki-base64", algorithm: "Ed25519" },
          nextIdentity: { keyId: nextKeyId, publicKey: "next-public-key", publicKeyFormat: "spki-base64", algorithm: "Ed25519" },
          artifactId: `sha256:${"c".repeat(64)}`,
          integrity: { canonicalization: "vraxis-json-c14n-v1", digestAlgorithm: "SHA-256", digest: "c".repeat(64), previousSignature: {}, nextSignature: {} },
        },
      }),
    });
  });
  await page.route("**/api/settings", async (route) => {
    const update = route.request().postDataJSON() as Record<string, string>;
    Object.assign(settingsState, update);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settingsState),
    });
  });
  await page.route("**/api/model-providers", async (route) => {
    connectedProvider = route.request().postDataJSON() as Record<string, string>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "provider-deepseek",
        name: "DeepSeek",
        provider: "deepseek",
        model: connectedProvider.model,
        credentialConfigured: true,
        models: [{ id: connectedProvider.model, name: "DeepSeek Flash", availability: "available" }],
      }),
    });
  });
  await page.route("**/api/runtimes/codex/probe", async (route) => {
    runtimeProbe = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runtimeId: "codex",
        conformance: {
          state: "ready",
          runtimeVersion: "0.149.1",
          checkedAt: new Date().toISOString(),
          durationMs: 240,
          detail: "This runtime passed its registered adapter checks and the bounded live output probe.",
          checks: [
            { id: "adapter-contract", label: "Adapter contract", state: "passed", detail: "Registered." },
            { id: "host-tool-isolation", label: "Host-tool isolation", state: "passed", detail: "Constrained." },
            { id: "live-output", label: "Live model response", state: "passed", detail: "Authenticated." },
          ],
        },
      }),
    });
  });
  await page.route("**/api/runtimes/codex/maintenance", async (route) => {
    maintenanceRequest = route.request().postDataJSON() as Record<string, string>;
    const timestamp = new Date().toISOString();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "maintenance-session",
        projectId: "vraxis-code",
        title: "Runtime Doctor: Update Codex CLI",
        mode: "ask",
        runtimeId: "codex",
        updatedAt: timestamp,
        status: "idle",
        events: [
          { id: "maintenance-message", sessionId: "maintenance-session", sequence: 1, kind: "message", actor: "user", title: "Runtime Doctor: Update Codex CLI", detail: "", state: "complete", timestamp },
          { id: "maintenance-ready", sessionId: "maintenance-session", sequence: 2, kind: "lifecycle", actor: "system", title: "Runtime maintenance prepared", detail: "Update Codex CLI will run after explicit approval.", state: "running", timestamp },
        ],
        approval: {
          id: "maintenance-approval",
          sessionId: "maintenance-session",
          projectId: "vraxis-code",
          capability: "command",
          title: "Update Codex CLI",
          description: "Run the official update action and retain its receipt.",
          scope: ". · /usr/local/bin/codex update",
          risk: "high",
          source: "terminal",
          rememberable: false,
          requestedAt: timestamp,
          state: "pending",
        },
        run: {
          id: "maintenance-run",
          sessionId: "maintenance-session",
          approvalId: "maintenance-approval",
          command: "/usr/local/bin/codex update",
          cwd: ".",
          status: "pending",
          output: "",
          terminalKind: "pty",
          columns: 100,
          rows: 30,
          outputVersion: 0,
        },
      }),
    });
  });
  await page.route("**/api/support-bundle", async (route) => route.fulfill({
    status: 200,
    contentType: "application/vnd.vraxis.support-bundle+json",
    headers: { "content-disposition": 'attachment; filename="vraxis-code-support-2026-08-31.json"' },
    body: JSON.stringify({
      kind: "vraxis.support-bundle",
      version: 1,
      generatedAt: new Date().toISOString(),
      application: { name: "Vraxis Code", version: "0.1.0", contractVersion: 24 },
      environment: { platform: "darwin", architecture: "arm64", node: "22.12.0", desktop: true },
      inventory: { projects: { total: 1, ready: 1, unavailable: 0 }, sessions: { idle: 1, running: 0, failed: 0, interrupted: 0 }, runtimes: [] },
      recovery: { previousUnexpectedExit: false, approvalsInterrupted: 0, terminalRunsInterrupted: 0, verificationsInterrupted: 0, worktreesNeedingReview: 0 },
      security: { loopbackOnly: true, desktopSessionProtected: true, rendererNodeAccess: false, includesProjectContent: false, includesCredentials: false },
    }),
  }));
  await page.goto("/?preview=project");
  await page.getByRole("button", { name: "Settings" }).click();

  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Files" })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /Graphite Dark/ })).toBeChecked();
  await page.getByRole("radio", { name: /Panther/ }).click();
  await expect(page.locator(".product-root")).toHaveAttribute("data-osx-theme", "panther");
  await page.getByRole("radio", { name: /Graphite Dark/ }).click();
  await expect(page.locator(".product-root")).toHaveAttribute("data-osx-theme", "graphite-dark");
  expect(settingsState.theme).toBe("graphite-dark");
  await page.getByRole("radio", { name: "Build Make changes inside an isolated worktree." }).click();
  await expect(page.getByRole("radio", { name: "Build Make changes inside an isolated worktree." })).toBeChecked();
  await expect(page.getByRole("heading", { name: "Agent harnesses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Proof identity & trust" })).toBeVisible();
  const diagnostics = page.locator(".support-diagnostics");
  await expect(diagnostics.getByRole("heading", { name: "Recovery & diagnostics" })).toBeVisible();
  await expect(diagnostics.getByText("Generated locally. Nothing is uploaded.", { exact: true })).toBeVisible();
  const supportDownload = page.waitForEvent("download");
  await diagnostics.getByRole("button", { name: "Export support bundle" }).click();
  await expect((await supportDownload).suggestedFilename()).toBe("vraxis-code-support-2026-08-31.json");
  await expect(diagnostics.getByText("Private support bundle exported. Review it before sharing.", { exact: true })).toBeVisible();
  await expect(page.getByText("No external signers", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rotate signing key" }).click();
  await expect(page.getByText(/Rotation is armed/)).toBeVisible();
  const rotationDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Confirm rotation" }).click();
  await expect((await rotationDownload).suggestedFilename()).toBe(`vraxis-proof-key-rotation-${"a".repeat(12)}-${"b".repeat(12)}.json`);
  expect(rotationRequest).toEqual({ confirmed: true });
  await expect(page.getByText("Rotation history", { exact: true })).toBeVisible();
  await expect(page.getByText(`${"a".repeat(12)} → ${"b".repeat(12)}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/old identity remains trusted/)).toBeVisible();
  await expect(page.locator(".harness-row").filter({ hasText: "Codex CLI" })).toBeVisible();
  await expect(page.locator(".harness-row").filter({ hasText: "Claude Code" })).toBeVisible();
  await expect(page.getByText("Live catalog")).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "GPT-5.6-Terra" }).click();
  await expect.poll(() => settingsState.runtimeModels?.codex).toBe("gpt-5.6-terra");
  await page.getByRole("radio", { name: "Configuration" }).click();
  await expect(page.getByText("Vraxis conformance", { exact: true })).toBeVisible();
  await expect(page.getByText(/may use provider quota/)).toBeVisible();
  await page.getByRole("button", { name: "Verify live" }).click();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();
  await expect(page.getByText("Live model response", { exact: true })).toBeVisible();
  expect(runtimeProbe).toEqual({ consent: true, modelId: "gpt-5.6-terra" });
  await page.screenshot({ path: testInfo.outputPath("runtime-conformance.png"), fullPage: true });
  await expect(page.getByText("Setup and maintenance", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to Codex CLI" })).toHaveCount(0);
  await page.getByRole("button", { name: "Update Codex CLI" }).click();
  expect(maintenanceRequest).toEqual({ projectId: "vraxis-code", actionId: "update" });
  await expect(page.getByText("Action needs your approval")).toBeVisible();
  await expect(page.getByText("/usr/local/bin/codex update", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("radio", { name: "Models" }).click();
  await expect(page.getByText("OpenRouter is optional.")).toBeVisible();
  await page.getByRole("button", { name: "Add provider" }).click();
  const providerForm = page.getByRole("form", { name: "Connect model provider" });
  await providerForm.getByRole("combobox", { name: "Provider", exact: true }).selectOption("deepseek");
  await providerForm.getByRole("textbox", { name: /^API key/ }).fill("temporary-test-key");
  await providerForm.getByRole("textbox", { name: /^Preferred model ID/ }).fill("deepseek-v4-flash");
  await page.getByRole("button", { name: "Verify and connect" }).click();
  await expect(page.getByRole("form", { name: "Connect model provider" })).toHaveCount(0);
  expect(connectedProvider).toEqual({
    provider: "deepseek",
    apiKey: "temporary-test-key",
    model: "deepseek-v4-flash",
  });
  await expect(page.getByText("temporary-test-key")).toHaveCount(0);
  await page.getByRole("listitem").filter({ hasText: "GPT-5.6-Sol" }).click();
  await expect.poll(() => settingsState.runtimeModels?.codex).toBe("gpt-5.6-sol");

  await page.screenshot({ path: testInfo.outputPath("settings.png"), fullPage: true });
  await expectBasicAccessibility(page);

  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Ask", exact: true })).toBeChecked();
  await page.getByRole("tab", { name: "Files" }).click();
  await page.locator('.tree-row[title="apps/service/src/http/app.ts"]').click();
  const keywordColor = await page.locator('[aria-label="File preview"] .hljs-keyword').first().evaluate(
    (element) => getComputedStyle(element).color,
  );
  expect(keywordColor).toBe("rgb(240, 138, 181)");
  expect(browserErrors).toEqual([]);
});

test("preserves the task at a narrow viewport without document overflow", async ({ page }) => {
  await routeProofTrust(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preview=project");
  await expect(page.getByRole("heading", { name: "Your first trusted task" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message to agent" })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Harness details" })).toBeVisible();
  const harnessHeight = await page.locator(".harness-workbench").evaluate((element) => element.getBoundingClientRect().height);
  const modelListHeight = await page.locator(".harness-model-list").evaluate((element) => element.getBoundingClientRect().height);
  expect(harnessHeight).toBeLessThan(1_000);
  expect(modelListHeight).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
