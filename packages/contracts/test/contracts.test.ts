import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultUserSettings,
  modeAgentProfile,
  modeAgentProfiles,
  parseAppendMessageRequest,
  parseApprovalDecisionRequest,
  parseBrowserActionRequest,
  parseCommandRequest,
  parseConnectModelProviderRequest,
  parseConnectMcpServerRequest,
  parseCreateTeamPolicyRequest,
  parseCreateProjectRequest,
  parseCreateSessionRequest,
  parseRegisterProjectRequest,
  parseTeamPolicyBundle,
  parseUpdateSettingsRequest,
  parseUpdateMcpServerProjectsRequest,
  normalizeBranchSlug,
  parseBranchSlug,
} from "../src/index.js";

test("publishes safe mode-specific default agent profiles", () => {
  assert.deepEqual(Object.keys(modeAgentProfiles), ["ask", "plan", "build", "review"]);
  assert.equal(modeAgentProfile("plan").access, "read-only");
  assert.ok(modeAgentProfile("plan").skillNames.includes("Project architecture"));
  assert.ok(modeAgentProfile("ask").skillNames.includes("Web research"));
  assert.ok(modeAgentProfile("plan").skillNames.includes("Web research"));
  assert.ok(modeAgentProfile("build").skillNames.includes("Workspace files"));
  assert.ok(!modeAgentProfile("plan").toolIds.includes("create-text"));
  assert.equal(modeAgentProfile("build").access, "isolated-worktree");
  assert.ok(modeAgentProfile("ask").toolIds.includes("evidence-status"));
  assert.ok(modeAgentProfile("ask").toolIds.includes("git-repository-state"));
  assert.ok(modeAgentProfile("ask").guardedToolIds.includes("git-refresh-remote"));
  assert.ok(modeAgentProfile("ask").toolIds.includes("browser-snapshot"));
  assert.ok(modeAgentProfile("ask").guardedToolIds.includes("browser-navigate"));
  assert.ok(modeAgentProfile("plan").guardedToolIds.includes("browser-type"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("terminal-run"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("terminal-poll"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("terminal-stop"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("create-text"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("remove-path"));
  assert.ok(modeAgentProfile("build").guardedToolIds.includes("browser-navigate"));
  assert.ok(modeAgentProfile("review").toolIds.includes("browser-network"));
  assert.ok(modeAgentProfile("review").guardedToolIds.includes("browser-click"));
  assert.ok(!modeAgentProfile("review").guardedToolIds.includes("terminal-run"));
});

test("parses a bounded project registration", () => {
  assert.deepEqual(parseRegisterProjectRequest({ path: " /tmp/example " }), { path: "/tmp/example" });
});

test("parses a bounded project creation request", () => {
  assert.deepEqual(parseCreateProjectRequest({ name: " my-app ", parentPath: " /tmp/parent " }), {
    name: "my-app",
    parentPath: "/tmp/parent",
  });
  assert.throws(
    () => parseCreateProjectRequest({ name: "", parentPath: "/tmp/parent" }),
    /Project name/,
  );
});

test("rejects an empty command", () => {
  assert.throws(
    () => parseCommandRequest({ sessionId: "session-1", command: "", cwd: "/tmp" }),
    /Command must be a non-empty string/,
  );
  assert.deepEqual(parseCommandRequest({ sessionId: "session-1", command: "npm test" }), {
    sessionId: "session-1",
    command: "npm test",
  });
  assert.throws(
    () => parseCommandRequest({ sessionId: "session-1", command: "npm test", cwd: "../outside" }),
    /inside the session workspace/,
  );
});

test("rejects browser actions outside the published capability set", () => {
  assert.throws(
    () => parseBrowserActionRequest({ sessionId: "session-1", action: "execute-script" }),
    /not supported/,
  );
});

test("parses browser tab actions", () => {
  assert.deepEqual(parseBrowserActionRequest({ sessionId: "session-1", action: "select-tab", tabId: "tab-1" }), {
    sessionId: "session-1",
    action: "select-tab",
    tabId: "tab-1",
  });
});

test("parses native browser history actions", () => {
  assert.deepEqual(parseBrowserActionRequest({ sessionId: "session-1", action: "forward" }), {
    sessionId: "session-1",
    action: "forward",
  });
});

test("parses explicit approval decisions", () => {
  assert.deepEqual(parseApprovalDecisionRequest({ decision: "approve" }), { decision: "approve" });
  assert.deepEqual(parseApprovalDecisionRequest({ decision: "approve", duration: "project" }), { decision: "approve", duration: "project" });
  assert.deepEqual(parseApprovalDecisionRequest({ decision: "deny" }), { decision: "deny" });
  assert.throws(() => parseApprovalDecisionRequest({ decision: "always" }), /approve or deny/);
  assert.throws(() => parseApprovalDecisionRequest({ decision: "approve", duration: "forever" }), /once, session, or project/);
});

test("parses a task with one of the four product modes", () => {
  assert.deepEqual(parseCreateSessionRequest({
    projectId: "project-1",
    mode: "build",
    runtimeId: "codex",
    modelId: "gpt-5.6-sol",
    prompt: " Add a health check ",
    attachments: [{ id: "project-file:src/index.ts", name: "index.ts", path: "src/index.ts" }],
    skillIds: ["skill-a", "skill-a", "skill-b"],
  }), {
    projectId: "project-1",
    mode: "build",
    runtimeId: "codex",
    modelId: "gpt-5.6-sol",
    prompt: "Add a health check",
    attachments: [{ id: "project-file:src/index.ts", name: "index.ts", path: "src/index.ts" }],
    skillIds: ["skill-a", "skill-b"],
  });
  assert.throws(() => parseCreateSessionRequest({ projectId: "p", mode: "auto", runtimeId: "r", prompt: "x" }), /not supported/);
  assert.throws(() => parseCreateSessionRequest({
    projectId: "p",
    mode: "ask",
    runtimeId: "r",
    prompt: "x",
    attachments: [{ id: "escape", name: "secret.txt", path: "../secret.txt" }],
  }), /project-relative/);
  assert.throws(() => parseCreateSessionRequest({
    projectId: "p",
    mode: "ask",
    runtimeId: "r",
    prompt: "x",
    attachments: Array.from({ length: 6 }, (_, index) => ({ id: `file-${index}`, name: `${index}.ts`, path: `src/${index}.ts` })),
  }), /no more than 5/);
  assert.throws(() => parseCreateSessionRequest({
    projectId: "p",
    mode: "ask",
    runtimeId: "r",
    prompt: "x",
    skillIds: Array.from({ length: 9 }, (_, index) => `skill-${index}`),
  }), /no more than 8/);
  assert.deepEqual(parseCreateSessionRequest({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Compare these files",
    attachments: [{
      id: "imported-file:12345678-1234-1234-1234-123456789abc",
      name: "notes.txt",
      path: "12345678-1234-1234-1234-123456789abc",
      source: "imported",
      mediaType: "text/plain",
      size: 12,
    }],
    attachmentConsent: {
      attachmentIds: ["imported-file:12345678-1234-1234-1234-123456789abc"],
      runtimeId: "codex",
      confirmed: true,
    },
  }), {
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Compare these files",
    attachments: [{
      id: "imported-file:12345678-1234-1234-1234-123456789abc",
      name: "notes.txt",
      path: "12345678-1234-1234-1234-123456789abc",
      source: "imported",
      mediaType: "text/plain",
      size: 12,
    }],
    attachmentConsent: {
      attachmentIds: ["imported-file:12345678-1234-1234-1234-123456789abc"],
      runtimeId: "codex",
      confirmed: true,
    },
  });
});

test("parses explicit task steering delivery", () => {
  assert.deepEqual(parseAppendMessageRequest({ prompt: "Check the failing test next", delivery: "queue" }), {
    prompt: "Check the failing test next",
    delivery: "queue",
  });
  assert.deepEqual(parseAppendMessageRequest({ prompt: "Stop and use the existing helper", delivery: "redirect" }), {
    prompt: "Stop and use the existing helper",
    delivery: "redirect",
  });
  assert.throws(() => parseAppendMessageRequest({ prompt: "Do this", delivery: "immediate" }), /queue or redirect/);
});

test("parses a follow-up runtime selection and rejects an empty follow-up", () => {
  assert.deepEqual(parseAppendMessageRequest({
    prompt: " Continue the review ",
    mode: "review",
    runtimeId: "claude-code",
    modelId: null,
    skillIds: ["skill-a", "skill-a"],
  }), {
    prompt: "Continue the review",
    mode: "review",
    runtimeId: "claude-code",
    modelId: null,
    skillIds: ["skill-a"],
  });
  assert.throws(() => parseAppendMessageRequest({ prompt: " " }), /Task must be a non-empty string/);
});

test("parses durable application settings", () => {
  assert.equal(defaultUserSettings.theme, "graphite-dark");
  assert.equal(defaultUserSettings.authorityMode, "supervised");
  assert.deepEqual(parseUpdateSettingsRequest({ theme: "graphite-dark" }), { theme: "graphite-dark" });
  assert.deepEqual(parseUpdateSettingsRequest({
    theme: "graphite",
    defaultMode: "build",
    authorityMode: "trusted-worktree",
    defaultRuntimeId: "codex",
    runtimeModels: { codex: "gpt-5.6-sol", opencode: null },
    disabledRuntimeIds: ["claude-code", "claude-code"],
  }), {
    theme: "graphite",
    defaultMode: "build",
    authorityMode: "trusted-worktree",
    defaultRuntimeId: "codex",
    runtimeModels: { codex: "gpt-5.6-sol", opencode: null },
    disabledRuntimeIds: ["claude-code"],
  });
  assert.throws(() => parseUpdateSettingsRequest({ theme: "midnight" }), /Theme is not supported/);
  assert.throws(() => parseUpdateSettingsRequest({ authorityMode: "unrestricted" }), /Authority mode is not supported/);
  assert.throws(() => parseUpdateSettingsRequest({}), /at least one setting/);
  assert.deepEqual(parseUpdateSettingsRequest({ harnessMetricsEnabled: true }), { harnessMetricsEnabled: true });
  assert.deepEqual(parseUpdateSettingsRequest({ harnessMetricsExportEnabled: false }), { harnessMetricsExportEnabled: false });
  assert.deepEqual(parseUpdateSettingsRequest({ harnessMetricsAutoApply: true }), { harnessMetricsAutoApply: true });
  assert.throws(() => parseUpdateSettingsRequest({ harnessMetricsEnabled: "yes" }), /Harness metrics setting must be true or false/);
  assert.throws(() => parseUpdateSettingsRequest({ harnessMetricsAutoApply: "yes" }), /Harness metrics auto-apply setting must be true or false/);
});

test("parses bounded MCP connections without accepting plaintext credential shortcuts", () => {
  assert.deepEqual(parseConnectMcpServerRequest({
    name: "Project tools",
    transport: "stdio",
    projectIds: ["project-1", "project-1"],
    command: "npx",
    args: ["-y", "@example/mcp-server"],
    credential: { kind: "environment", name: "EXAMPLE_TOKEN", value: "secret" },
  }), {
    name: "Project tools",
    transport: "stdio",
    projectIds: ["project-1"],
    command: "npx",
    args: ["-y", "@example/mcp-server"],
    credential: { kind: "environment", name: "EXAMPLE_TOKEN", value: "secret" },
  });
  assert.deepEqual(parseConnectMcpServerRequest({
    name: "Remote tools",
    transport: "streamable-http",
    projectIds: ["project-1"],
    url: "https://mcp.example.com/connect",
    credential: { kind: "bearer", value: "secret" },
  }), {
    name: "Remote tools",
    transport: "streamable-http",
    projectIds: ["project-1"],
    url: "https://mcp.example.com/connect",
    credential: { kind: "bearer", value: "secret" },
  });
  assert.deepEqual(parseUpdateMcpServerProjectsRequest({ projectIds: [] }), { projectIds: [] });
  assert.throws(() => parseConnectMcpServerRequest({ name: "Bad", transport: "stdio", projectIds: [], command: "node" }), /between 1 and 64/);
  assert.throws(() => parseConnectMcpServerRequest({
    name: "Bad",
    transport: "stdio",
    projectIds: ["project-1"],
    command: "node",
    credential: { kind: "bearer", value: "secret" },
  }), /environment variable/);
  assert.throws(() => parseConnectMcpServerRequest({
    name: "Bad",
    transport: "streamable-http",
    projectIds: ["project-1"],
    url: "https://example.com",
    credential: { kind: "header", value: "secret" },
  }), /Name the MCP credential/);
});

test("parses model provider connections without inventing optional fields", () => {
  assert.deepEqual(parseConnectModelProviderRequest({
    provider: "zai",
    apiKey: "secret",
    model: "glm-4.7-flash",
  }), {
    provider: "zai",
    apiKey: "secret",
    model: "glm-4.7-flash",
  });
  assert.throws(() => parseConnectModelProviderRequest({ provider: "unknown" }), /not supported/);
});

test("parses bounded team-policy requests and signed bundles", () => {
  assert.deepEqual(parseCreateTeamPolicyRequest({
    organization: "Example Engineering",
    rules: [
      { capability: "credentials", effect: "deny" },
      { capability: "command", effect: "ask" },
    ],
  }), {
    organization: "Example Engineering",
    rules: [
      { capability: "credentials", effect: "deny" },
      { capability: "command", effect: "ask" },
    ],
  });
  const bundle = parseTeamPolicyBundle({
    kind: "vraxis.team-policy",
    version: 1,
    policyId: "policy-1",
    organization: "Example Engineering",
    issuedAt: "2026-08-31T12:00:00.000Z",
    rules: [{ id: "credentials:deny", capability: "credentials", effect: "deny", reason: "Credentials stay local." }],
    artifactId: `sha256:${"a".repeat(64)}`,
    integrity: {
      algorithm: "Ed25519",
      canonicalization: "vraxis-json-c14n-v1",
      digestAlgorithm: "SHA-256",
      digest: "a".repeat(64),
      signature: "signature",
      publicKey: "public-key",
      publicKeyFormat: "spki-base64",
      keyId: "b".repeat(64),
    },
  });
  assert.equal(bundle.rules[0]?.effect, "deny");
  assert.throws(() => parseCreateTeamPolicyRequest({
    organization: "Example Engineering",
    rules: [{ capability: "command", effect: "ask" }, { capability: "command", effect: "deny" }],
  }), /duplicated/);
  assert.throws(() => parseTeamPolicyBundle({ kind: "vraxis.team-policy", version: 2 }), /not supported/);
});

test("normalizes and parses optional Build branch slugs", () => {
  assert.equal(normalizeBranchSlug(" Fix/Login-Bug "), "fix/login-bug");
  assert.equal(parseBranchSlug("feature/foo"), "feature/foo");
  assert.equal(parseBranchSlug(undefined), undefined);
  assert.deepEqual(parseCreateSessionRequest({
    projectId: "project-1",
    mode: "build",
    runtimeId: "codex",
    prompt: "Fix login",
    branchSlug: " fix/login-bug ",
  }), {
    projectId: "project-1",
    mode: "build",
    runtimeId: "codex",
    prompt: "Fix login",
    branchSlug: "fix/login-bug",
  });
  assert.throws(() => parseCreateSessionRequest({
    projectId: "project-1",
    mode: "ask",
    runtimeId: "codex",
    prompt: "Fix login",
    branchSlug: "fix/login-bug",
  }), /Build mode/);
  assert.deepEqual(parseAppendMessageRequest({
    prompt: "Continue the fix",
    branchSlug: "fix/login-bug",
  }), {
    prompt: "Continue the fix",
    branchSlug: "fix/login-bug",
  });
  assert.throws(() => normalizeBranchSlug(".."), /invalid/);
});
