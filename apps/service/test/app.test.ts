import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  MemoryCredentialStore,
  type CodingRuntimeEngine,
  type CodingRuntimeRequest,
  type CodingRuntimeResult,
  type EventSink,
} from "@vraxis/agent-v";
import { DeterministicCodingRuntimeEngine, InterruptibleCodingRuntimeEngine } from "@vraxis/code-test-runtime";
import type { ProofKeyRotationAttestationV1, ProofTrustState, TaskProofEnvelopeV1, UnderstandArtifactEnvelopeV1 } from "@vraxis/code-contracts";
import { BrowserWorkspace } from "../src/browser/browser-workspace.js";
import { createApp, type AppOptions } from "../src/http/app.js";
import type { McpConnector } from "../src/mcp/mcp-server-registry.js";
import { TaskProofSigner, verifyProofKeyRotation, verifyTaskProof } from "../src/receipts/task-proof.js";
import { verifyUnderstandArtifact } from "../src/receipts/understand-artifact.js";
import { VerificationRegistry } from "../src/verification/verification-registry.js";

async function fixture(
  folderPicker?: () => Promise<string | null>,
  runtimeEngine: CodingRuntimeEngine = new DeterministicCodingRuntimeEngine(),
  providerOptions: Pick<AppOptions, "credentialStore" | "providerFetch" | "discoverSkills" | "discover" | "projectInspector" | "browserWorkspace" | "runtimeProbeEngine" | "mcpConnect"> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "vraxis-code-test-"));
  const dataDirectory = join(root, "data");
  const project = join(root, "project");
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(join(project, ".idea"), { recursive: true });
  await writeFile(join(project, "src", "index.ts"), "export const ready = true;\n");
  await writeFile(join(project, ".idea", "workspace.xml"), "<project />\n");
  const application = createApp({
    dataDirectory,
    discover: async () => [{
      id: "codex",
      name: "Codex",
      availability: "installed",
      detail: "Available",
      acceptsCustomModel: true,
      models: [],
    }],
    runtimeEngine,
    discoverSkills: async () => ({ generatedAt: new Date().toISOString(), skills: [], sources: [], unresolvedSources: [] }),
    ...providerOptions,
    ...(folderPicker ? { folderPicker } : {}),
  });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test service did not start.");
  return {
    project,
    dataDirectory,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
      await application.close();
    },
  };
}

class ControlledFirstRunEngine extends DeterministicCodingRuntimeEngine {
  readonly prompts: string[] = [];
  readonly firstStarted: Promise<void>;
  private releaseFirstRun?: () => void;
  private resolveFirstStarted!: () => void;
  private runCount = 0;

  constructor() {
    super();
    this.firstStarted = new Promise<void>((resolve) => { this.resolveFirstStarted = resolve; });
  }

  releaseFirst(): void {
    this.releaseFirstRun?.();
  }

  override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
    const index = this.runCount++;
    this.prompts.push(request.input.prompt);
    if (index === 0) {
      this.resolveFirstStarted();
      await new Promise<void>((resolve, reject) => {
        this.releaseFirstRun = resolve;
        if (request.abortSignal?.aborted) {
          reject(new DOMException("The task was stopped.", "AbortError"));
          return;
        }
        request.abortSignal?.addEventListener("abort", () => reject(new DOMException("The task was stopped.", "AbortError")), { once: true });
      });
    }
    return super.run(request, sink);
  }
}

const execFileAsync = promisify(execFile);

test("exposes graceful resource shutdown for the service host", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-code-close-test-"));
  class ObservedBrowserWorkspace extends BrowserWorkspace {
    closed = false;
    override async close(): Promise<void> {
      this.closed = true;
      await super.close();
    }
  }
  const browser = new ObservedBrowserWorkspace(root, new MemoryCredentialStore());
  const app = createApp({ dataDirectory: root, browserWorkspace: browser });
  await app.close();
  assert.equal(browser.closed, true);
});

test("advertises and streams reconnectable session updates", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const registered = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await registered.json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "First question" }),
  });
  const session = await created.json() as { id: string };
  await waitForIdle(app.baseUrl);

  const bootstrap = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    realtime?: { sessionEvents: boolean; terminalOutput: boolean; reconnectSnapshots: boolean };
  };
  assert.deepEqual(bootstrap.realtime, {
    sessionEvents: true,
    terminalOutput: true,
    reconnectSnapshots: true,
  });

  const abort = new AbortController();
  context.after(() => abort.abort());
  const response = await fetch(`${app.baseUrl}/api/sessions/${session.id}/stream`, { signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let streamText = "";
  const readUntil = async (pattern: RegExp): Promise<void> => {
    while (!pattern.test(streamText)) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Session stream timed out.")), 1_000)),
      ]);
      if (result.done) break;
      streamText += decoder.decode(result.value, { stream: true });
    }
    assert.match(streamText, pattern);
  };
  await readUntil(/event: snapshot[\s\S]*First question/);

  const appended = await fetch(`${app.baseUrl}/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Follow-up question" }),
  });
  assert.equal(appended.status, 201);
  await readUntil(/event: update[\s\S]*Follow-up question/);
  assert.match(streamText, /"evidence":\{"approvals":\[\]/);
  abort.abort();
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return result.stdout.trim();
}

async function freeLoopbackPort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a loopback port.");
  await new Promise<void>((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForIdle(baseUrl: string): Promise<{
  sessions: Array<{ id: string; status: string }>;
  events: Array<{ actor?: string; title: string; sequence: number; kind?: string; state?: string; attachments?: Array<{ path: string }> }>;
}> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await (await fetch(`${baseUrl}/api/bootstrap`)).json() as {
      sessions: Array<{ id: string; status: string }>;
      events: Array<{ actor?: string; title: string; sequence: number; kind?: string; state?: string; attachments?: Array<{ path: string }> }>;
    };
    if (state.sessions[0]?.status === "idle") return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Deterministic task did not finish.");
}

test("uses the system folder chooser to register a browser project", async (context) => {
  let selectedProject = "";
  const app = await fixture(async () => selectedProject);
  selectedProject = app.project;
  context.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/projects/pick-folder`, { method: "POST" });
  const result = await response.json() as { cancelled: boolean; project?: { path: string } };
  assert.equal(response.status, 200);
  assert.equal(result.cancelled, false);
  assert.equal(result.project?.path, await realpath(app.project));
});

test("leaves project state unchanged when the system folder chooser is cancelled", async (context) => {
  const app = await fixture(async () => null);
  context.after(() => app.close());

  const response = await fetch(`${app.baseUrl}/api/projects/pick-folder`, { method: "POST" });
  assert.deepEqual(await response.json(), { cancelled: true });
  const state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { projects: unknown[] };
  assert.deepEqual(state.projects, []);
});

test("registers and reopens a project with indexed files", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const registered = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  assert.equal(registered.status, 201);
  const bootstrap = await fetch(`${app.baseUrl}/api/bootstrap`);
  const state = await bootstrap.json() as { projects: unknown[]; files: Array<{ path: string }> };
  assert.equal(state.projects.length, 1);
  assert.deepEqual(state.files, [{ path: "src/index.ts" }]);
});

test("serves staged bootstrap scopes and caches local runtime discovery", async (context) => {
  let discoveries = 0;
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), {
    discover: async () => {
      discoveries += 1;
      return [{
        id: "codex",
        name: "Codex",
        availability: "installed",
        detail: "Available",
        acceptsCustomModel: true,
        models: [],
        kind: "local-cli",
        authentication: "authenticated",
        authenticationDetail: "Ready",
        checkedAt: new Date().toISOString(),
        modelDiscovery: "automatic",
        update: { status: "unknown", detail: "Ready" },
        maintenanceActions: [],
      }];
    },
  });
  context.after(() => app.close());
  await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const shell = await (await fetch(`${app.baseUrl}/api/bootstrap?scope=shell`)).json() as {
    projects: unknown[];
    runtimes: unknown[];
    files: unknown[];
    skills: unknown[];
  };
  assert.equal(shell.projects.length, 1);
  assert.deepEqual(shell.runtimes, []);
  assert.deepEqual(shell.files, []);
  assert.deepEqual(shell.skills, []);
  const catalog = await (await fetch(`${app.baseUrl}/api/bootstrap?scope=catalog`)).json() as {
    runtimes: Array<{ id: string }>;
    skills: unknown[];
  };
  assert.equal(catalog.runtimes[0]?.id, "codex");
  assert.ok(catalog.skills.length >= 0);
  assert.equal(discoveries, 1);
  await fetch(`${app.baseUrl}/api/bootstrap?scope=catalog`);
  assert.equal(discoveries, 1);
});

test("previews text files inside the approved project and rejects escaping symlinks", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const outside = join(await mkdtemp(join(tmpdir(), "vraxis-code-outside-")), "secret.txt");
  await writeFile(outside, "not approved\n");
  await symlink(outside, join(app.project, "src", "outside.txt"));
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const preview = await fetch(`${app.baseUrl}/api/projects/${project.id}/file?path=${encodeURIComponent("src/index.ts")}`);
  assert.equal(preview.status, 200);
  assert.deepEqual(await preview.json(), {
    path: "src/index.ts",
    content: "export const ready = true;\n",
    language: "typescript",
    truncated: false,
  });
  const escaped = await fetch(`${app.baseUrl}/api/projects/${project.id}/file?path=${encodeURIComponent("src/outside.txt")}`);
  assert.equal(escaped.status, 400);
  assert.match((await escaped.json() as { error: string }).error, /outside the approved project/);
});

test("persists settings through the local service", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const initial = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { settings: { theme: string } };
  assert.equal(initial.settings.theme, "graphite-dark");
  const updated = await fetch(`${app.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      theme: "graphite",
      defaultMode: "build",
      defaultRuntimeId: "codex",
      runtimeModels: { codex: "gpt-5.6-sol" },
      disabledRuntimeIds: ["opencode"],
    }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(await updated.json(), {
    theme: "graphite",
    defaultMode: "build",
    authorityMode: "supervised",
    defaultRuntimeId: "codex",
    runtimeModels: { codex: "gpt-5.6-sol" },
    disabledRuntimeIds: ["opencode"],
  });

  const bootstrap = await fetch(`${app.baseUrl}/api/bootstrap`);
  const state = await bootstrap.json() as { settings: unknown };
  assert.deepEqual(state.settings, {
    theme: "graphite",
    defaultMode: "build",
    authorityMode: "supervised",
    defaultRuntimeId: "codex",
    runtimeModels: { codex: "gpt-5.6-sol" },
    disabledRuntimeIds: ["opencode"],
  });
});

test("rotates the local proof identity only after confirmation and returns a portable attestation", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const before = await (await fetch(`${app.baseUrl}/api/proof/trust`)).json() as ProofTrustState;

  const unconfirmed = await fetch(`${app.baseUrl}/api/proof/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal((await (await fetch(`${app.baseUrl}/api/proof/trust`)).json() as ProofTrustState).identity.keyId, before.identity.keyId);

  const response = await fetch(`${app.baseUrl}/api/proof/rotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(response.status, 201);
  const result = await response.json() as { state: ProofTrustState; attestation: ProofKeyRotationAttestationV1 };
  assert.notEqual(result.state.identity.keyId, before.identity.keyId);
  assert.equal(result.state.signers.find((signer) => signer.keyId === before.identity.keyId)?.revokedAt, undefined);
  assert.equal(result.state.rotations?.[0]?.artifactId, result.attestation.artifactId);
  assert.equal(verifyProofKeyRotation(result.attestation), true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY/);
});

test("refreshes the local harness inventory on demand", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const response = await fetch(`${app.baseUrl}/api/runtimes/refresh`, { method: "POST" });
  assert.equal(response.status, 200);
  const result = await response.json() as { runtimes: Array<{ id: string }> };
  assert.deepEqual(result.runtimes.map((runtime) => runtime.id), ["codex"]);
});

test("runs an explicit bounded runtime probe and persists version-bound conformance", async (context) => {
  let probedModel = "";
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), {
    discover: async () => [{
      id: "codex",
      name: "Codex CLI",
      availability: "installed",
      detail: "Installed.",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      version: "codex 1.0.0",
    }],
    runtimeProbeEngine: {
      async probe(runtimeId, runtimeModel) {
        assert.equal(runtimeId, "codex");
        probedModel = runtimeModel ?? "";
        return {
          runtimeId,
          availability: "installed",
          verification: "ready",
          version: "codex 1.0.0",
          checkedAt: "2026-08-31T12:00:00.000Z",
          durationMs: 25,
          detail: "Authenticated and returned schema-valid bounded output.",
        };
      },
    },
  });
  context.after(() => app.close());

  const rejected = await fetch(`${app.baseUrl}/api/runtimes/codex/probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ modelId: "gpt-5" }),
  });
  assert.equal(rejected.status, 400);

  const response = await fetch(`${app.baseUrl}/api/runtimes/codex/probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true, modelId: "gpt-5" }),
  });
  assert.equal(response.status, 200);
  const result = await response.json() as { conformance: { state: string; checks: Array<{ state: string }> } };
  assert.equal(probedModel, "gpt-5");
  assert.equal(result.conformance.state, "ready");
  assert.deepEqual(result.conformance.checks.map((check) => check.state), ["passed", "passed", "passed"]);

  const refreshed = await (await fetch(`${app.baseUrl}/api/runtimes/refresh`, { method: "POST" })).json() as {
    runtimes: Array<{ conformance?: { state: string } }>;
  };
  assert.equal(refreshed.runtimes[0]?.conformance?.state, "ready");
});

test("completes the clean-install journey from harness verification to portable proof within the readiness budget", async (context) => {
  const startedAt = performance.now();
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), {
    discover: async () => [{
      id: "codex",
      name: "Codex CLI",
      availability: "installed",
      authentication: "authenticated",
      detail: "Installed.",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      version: "codex 1.0.0",
    }],
    runtimeProbeEngine: {
      async probe(runtimeId) {
        return {
          runtimeId,
          availability: "installed",
          verification: "ready",
          version: "codex 1.0.0",
          checkedAt: new Date().toISOString(),
          durationMs: 20,
          detail: "Authenticated and returned schema-valid bounded output.",
        };
      },
    },
  });
  context.after(() => app.close());
  await writeFile(join(app.project, "package.json"), JSON.stringify({
    name: "first-run-fixture",
    private: true,
    scripts: { test: "node -e \"console.log('first-run-ready')\"" },
  }));

  const probe = await fetch(`${app.baseUrl}/api/runtimes/codex/probe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ consent: true }),
  });
  assert.equal(probe.status, 200);

  const registered = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await registered.json() as { id: string };
  assert.equal(registered.status, 201);
  const inspected = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    projectDoctor?: { ok: boolean; verificationChecks: Array<{ title: string }> };
  };
  assert.equal(inspected.projectDoctor?.ok, true);
  assert.equal(inspected.projectDoctor?.verificationChecks[0]?.title, "Test");

  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Explain this project with file-backed evidence." }),
  });
  const session = await created.json() as { id: string };
  assert.equal(created.status, 201);
  await waitForIdle(app.baseUrl);

  const handoff = await new VerificationRegistry(app.dataDirectory).requestHandoff({
    sessionId: session.id,
    runtimeId: "codex",
    note: "Run the exact project-owned checks before delivery.",
  });
  const handedOff = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as {
    verificationHandoffs?: Array<{ id: string; state: string }>;
  };
  assert.deepEqual(handedOff.verificationHandoffs?.map((item) => [item.id, item.state]), [[handoff.id, "requested"]]);

  const verification = await fetch(`${app.baseUrl}/api/sessions/${session.id}/verifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handoffId: handoff.id }),
  });
  const scheduled = await verification.json() as { approval: { id: string }; handoff: { state: string; verificationRunId?: string } };
  assert.equal(verification.status, 202);
  assert.equal(scheduled.handoff.state, "accepted");
  assert.match(scheduled.handoff.verificationRunId ?? "", /^[0-9a-f-]{36}$/);
  const approved = await fetch(`${app.baseUrl}/api/approvals/${scheduled.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(approved.status, 200);

  let state: {
    verificationRuns?: Array<{ state: string; checks: Array<{ state: string; failure?: string; terminalRunId?: string }> }>;
    terminalRuns?: Array<{ id: string; status: string; exitCode?: number; output: string }>;
  } | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    state = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as typeof state;
    if (state?.verificationRuns?.[0]?.state === "passed") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    state?.verificationRuns?.[0]?.state,
    "passed",
    `Clean-install verification evidence: ${JSON.stringify(state)}`,
  );
  const proof = await fetch(`${app.baseUrl}/api/sessions/${session.id}/proof.json`);
  assert.equal(proof.status, 200);
  const envelope = await proof.json() as TaskProofEnvelopeV1;
  assert.equal(verifyTaskProof(envelope), true);
  assert.equal(envelope.receipt.verificationHandoffs?.[0]?.state, "accepted");
  assert.ok(performance.now() - startedAt < 15_000, "clean-install readiness journey exceeded 15 seconds");
});

test("exports the local proof identity and manages enrolled signer trust", async (context) => {
  const app = await fixture();
  const remoteRoot = await mkdtemp(join(tmpdir(), "vraxis-remote-proof-identity-"));
  context.after(() => app.close());
  const remoteIdentity = await new TaskProofSigner(remoteRoot).identity();

  const initial = await (await fetch(`${app.baseUrl}/api/proof/trust`)).json() as {
    identity: { keyId: string; publicKey: string };
    signers: unknown[];
  };
  assert.match(initial.identity.keyId, /^[0-9a-f]{64}$/);
  assert.equal(initial.signers.length, 0);
  assert.doesNotMatch(JSON.stringify(initial), /PRIVATE KEY/);

  const enrolled = await fetch(`${app.baseUrl}/api/proof/trust`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "Release builder", publicKey: remoteIdentity.publicKey }),
  });
  assert.equal(enrolled.status, 201);
  const enrolledState = await enrolled.json() as { state: { signers: Array<{ keyId: string; revokedAt?: string }> } };
  assert.equal(enrolledState.state.signers[0]?.keyId, remoteIdentity.keyId);
  assert.equal(enrolledState.state.signers[0]?.revokedAt, undefined);

  const revoked = await fetch(`${app.baseUrl}/api/proof/trust/${remoteIdentity.keyId}`, { method: "DELETE" });
  assert.equal(revoked.status, 200);
  const revokedState = await revoked.json() as { state: { signers: Array<{ revokedAt?: string }> } };
  assert.ok(revokedState.state.signers[0]?.revokedAt);
});

test("creates, installs, audits, and deliberately removes a signed team policy", async (context) => {
  const app = await fixture();
  context.after(() => app.close());

  const initial = await (await fetch(`${app.baseUrl}/api/team-policy`)).json() as { status: string };
  assert.equal(initial.status, "none");

  const signed = await fetch(`${app.baseUrl}/api/team-policy/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization: "Example Engineering",
      rules: [
        { capability: "command", effect: "ask" },
        { capability: "credentials", effect: "deny" },
      ],
    }),
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.headers.get("content-type"), "application/vnd.vraxis.team-policy+json; charset=utf-8");
  const bundle = await signed.json() as { artifactId: string; organization: string };
  assert.match(bundle.artifactId, /^sha256:[0-9a-f]{64}$/);
  assert.equal(bundle.organization, "Example Engineering");

  const installed = await fetch(`${app.baseUrl}/api/team-policy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(bundle),
  });
  assert.equal(installed.status, 201);
  const installedState = await installed.json() as { status: string; policy?: { organization: string; rules: unknown[] } };
  assert.equal(installedState.status, "active");
  assert.equal(installedState.policy?.organization, "Example Engineering");
  assert.equal(installedState.policy?.rules.length, 2);

  const audit = await fetch(`${app.baseUrl}/api/approval-rules/audit`);
  assert.equal(audit.status, 200);
  const auditBody = await audit.json() as { teamPolicy?: { artifactId: string; status: string } };
  assert.equal(auditBody.teamPolicy?.artifactId, bundle.artifactId);
  assert.equal(auditBody.teamPolicy?.status, "active");

  const unconfirmed = await fetch(`${app.baseUrl}/api/team-policy`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal((await (await fetch(`${app.baseUrl}/api/team-policy`)).json() as { status: string }).status, "active");

  const removed = await fetch(`${app.baseUrl}/api/team-policy`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json() as { status: string }).status, "none");
});

test("prepares runtime maintenance as a dedicated approval-gated terminal task", async (context) => {
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), {
    discover: async () => [{
      id: "codex",
      name: "Codex CLI",
      availability: "installed",
      detail: "Installed.",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      executable: process.execPath,
      maintenanceActions: [{
        id: "update",
        label: "Update Codex CLI",
        detail: "Run the verified update action.",
        kind: "command",
        executable: process.execPath,
        arguments: ["-e", "console.log('runtime maintained')"],
        requiresNetwork: false,
      }],
    }],
  });
  context.after(() => app.close());

  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const response = await fetch(`${app.baseUrl}/api/runtimes/codex/maintenance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, actionId: "update" }),
  });
  const prepared = await response.json() as {
    id: string;
    events: Array<{ title: string }>;
    approval: { id: string; state: string; rememberable?: boolean; scope: string };
    run: { id: string; status: string; command: string };
  };
  assert.equal(response.status, 202);
  assert.equal(prepared.approval.state, "pending");
  assert.equal(prepared.approval.rememberable, false);
  assert.match(prepared.approval.scope, /node.*runtime maintained/);
  assert.equal(prepared.run.status, "pending");
  assert.match(prepared.run.command, /runtime maintained/);
  assert.ok(prepared.events.some((event) => event.title === "Runtime maintenance prepared"));

  const approved = await fetch(`${app.baseUrl}/api/approvals/${prepared.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", duration: "once" }),
  });
  assert.equal(approved.status, 200);

  let completed: { terminalRuns: Array<{ status: string; output: string }>; events: Array<{ title: string }> } | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    completed = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as typeof completed;
    if (
      completed?.terminalRuns[0]?.status === "success"
      && completed.events.some((event) => event.title === "Runtime maintenance complete")
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(completed?.terminalRuns[0]?.status, "success");
  assert.match(completed?.terminalRuns[0]?.output ?? "", /runtime maintained/);
  assert.ok(completed?.events.some((event) => event.title === "Runtime maintenance complete"));
});

test("connects a direct model provider without exposing its credential", async (context) => {
  const secret = "test-provider-secret";
  const credentials = new MemoryCredentialStore();
  let discoveryRequests = 0;
  const providerFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    discoveryRequests += 1;
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${secret}`);
    return new Response(JSON.stringify({
      data: [{
        id: "z-ai/glm-4.7-flash",
        name: "GLM 4.7 Flash",
        context_length: 131_072,
        supported_parameters: ["tools", "structured_outputs"],
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), { credentialStore: credentials, providerFetch });
  context.after(() => app.close());

  const connectedResponse = await fetch(`${app.baseUrl}/api/model-providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "openrouter", name: "My models", apiKey: secret }),
  });
  assert.equal(connectedResponse.status, 201);
  const connected = await connectedResponse.json() as { id: string; model: string; models: Array<{ id: string; capabilities: string[] }> };
  assert.equal(connected.model, "z-ai/glm-4.7-flash");
  assert.deepEqual(connected.models[0]?.capabilities, ["text", "tools", "structured-output"]);
  assert.doesNotMatch(JSON.stringify(connected), new RegExp(secret));

  const registryContents = await readFile(join(app.dataDirectory, "model-providers.json"), "utf8");
  assert.doesNotMatch(registryContents, new RegExp(secret));
  const state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    modelProviders: Array<{ id: string }>;
    runtimes: Array<{ id: string; kind?: string; models: Array<{ id: string }>; productCapabilities?: Array<{ id: string; state: string }> }>;
  };
  assert.equal(state.modelProviders[0]?.id, connected.id);
  const providerRuntime = state.runtimes.find((item) => item.id === connected.id);
  assert.equal(providerRuntime?.productCapabilities?.find((item) => item.id === "controlled-browser")?.state, "available");
  const { productCapabilities: _productCapabilities, ...runtimeWithoutProductCapabilities } = providerRuntime!;
  assert.equal(_productCapabilities?.length, 9);
  assert.deepEqual(runtimeWithoutProductCapabilities, {
    id: connected.id,
    name: "My models",
    availability: "installed",
    detail: "1 model available through My models.",
    acceptsCustomModel: true,
    models: connected.models,
    kind: "hosted-provider",
    providerProfileId: connected.id,
    modelDiscovery: "automatic",
    capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "tools", "artifacts", "browser-control"],
  });

  assert.equal((await fetch(`${app.baseUrl}/api/model-providers/${connected.id}/refresh`, { method: "POST" })).status, 200);
  assert.equal(discoveryRequests, 2);
  assert.equal((await fetch(`${app.baseUrl}/api/model-providers/${connected.id}`, { method: "DELETE" })).status, 200);
  const removed = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { modelProviders: unknown[] };
  assert.deepEqual(removed.modelProviders, []);
});

test("governs MCP connection discovery and project access through the approval lifecycle", async (context) => {
  const secret = "test-mcp-secret";
  const credentials = new MemoryCredentialStore();
  let connections = 0;
  const mcpConnect: McpConnector = async (definition, options) => {
    connections += 1;
    const decision = await options.authorizer.decide({
      serverId: definition.id,
      serverName: definition.name,
      action: definition.transport.type === "stdio" ? "launch-local-process" : "connect-remote-server",
      transport: definition.transport.type,
      target: definition.transport.type === "stdio" ? definition.transport.command : definition.transport.url,
      ...(definition.transport.type === "stdio" ? { workingDirectory: definition.transport.cwd } : {}),
      credentialReferences: [],
    });
    assert.equal(decision, "approved");
    return {
      inventory: {
        serverId: definition.id,
        configuredName: definition.name,
        serverName: "Fixture MCP",
        serverVersion: "1.0.0",
        protocolEra: "modern",
        protocolVersion: "2026-06-18",
        tools: [{ name: "search", agentToolName: `mcp__${definition.id}__search`, description: "Search project documentation." }],
        resources: [{ uri: "fixture://docs", name: "docs", description: "Project documentation." }],
        resourceTemplates: [],
        prompts: [{ name: "review", description: "Review a change." }],
        warnings: [],
      },
      tools: [],
      async close() {},
    };
  };
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), { credentialStore: credentials, mcpConnect });
  context.after(() => app.close());
  const registered = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await registered.json() as { id: string };

  const preparedResponse = await fetch(`${app.baseUrl}/api/mcp-servers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Project docs",
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
      projectIds: [project.id],
      credential: { kind: "environment", name: "FIXTURE_TOKEN", value: secret },
    }),
  });
  assert.equal(preparedResponse.status, 202);
  const prepared = await preparedResponse.json() as { approval: { id: string; state: string; source: string } };
  assert.equal(prepared.approval.state, "pending");
  assert.equal(prepared.approval.source, "mcp");
  assert.equal(connections, 0);
  assert.deepEqual((await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { mcpServers: unknown[] }).mcpServers, []);

  const approved = await fetch(`${app.baseUrl}/api/approvals/${prepared.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(approved.status, 200);
  assert.equal(connections, 1);
  const connectedState = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    mcpServers: Array<{ id: string; status: string; tools: Array<{ name: string }>; projectIds: string[] }>;
  };
  const connection = connectedState.mcpServers[0]!;
  assert.equal(connection.status, "connected");
  assert.equal(connection.tools[0]?.name, "search");
  assert.deepEqual(connection.projectIds, [project.id]);
  const registryContents = await readFile(join(app.dataDirectory, "mcp-servers.json"), "utf8");
  assert.doesNotMatch(registryContents, new RegExp(secret));

  const disabled = await fetch(`${app.baseUrl}/api/mcp-servers/${connection.id}/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectIds: [] }),
  });
  assert.equal(disabled.status, 200);
  assert.deepEqual((await disabled.json() as { projectIds: string[] }).projectIds, []);
  assert.equal((await fetch(`${app.baseUrl}/api/mcp-servers/${connection.id}`, { method: "DELETE" })).status, 200);
  assert.deepEqual((await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { mcpServers: unknown[] }).mcpServers, []);
});

test("rejects non-loopback origins", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const response = await fetch(`${app.baseUrl}/api/health`, { headers: { origin: "https://example.com" } });
  assert.equal(response.status, 403);
});

test("applies a restrictive browser security policy to every local response", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const response = await fetch(`${app.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") ?? "", /object-src 'none'/);
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/);
});

test("requires the desktop session before protected routes", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-code-auth-"));
  const application = createApp({ dataDirectory: root, desktopToken: "secret", discover: async () => [] });
  const server = createServer(application);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
    await application.close();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test service did not start.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${baseUrl}/api/bootstrap`)).status, 401);
  const exchange = await fetch(`${baseUrl}/app?desktop_token=secret`, { redirect: "manual" });
  assert.equal(exchange.status, 302);
  const setCookies = exchange.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) => value.startsWith("vraxis_code_session=")) ?? "";
  const csrfCookie = setCookies.find((value) => value.startsWith("vraxis_code_csrf=")) ?? "";
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Max-Age=86400/);
  assert.match(csrfCookie, /SameSite=Strict/);
  assert.doesNotMatch(setCookies.join(";"), /secret|=desktop/);
  const cookie = [sessionCookie, csrfCookie].map((value) => value.split(";", 1)[0]).join("; ");
  const csrf = csrfCookie.split("=", 2)[1]!.split(";", 1)[0]!;
  assert.equal((await fetch(`${baseUrl}/api/bootstrap`, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(`${baseUrl}/api/bootstrap`, { headers: { cookie: "vraxis_code_session=desktop" } })).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/runtimes/refresh`, { method: "POST", headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${baseUrl}/api/runtimes/refresh`, { method: "POST", headers: { cookie, "x-vraxis-csrf": csrf } })).status, 200);
  assert.equal((await fetch(`${baseUrl}/app?desktop_token=secret`, { redirect: "manual" })).status, 401);
});

test("executes an Ask task and restores its ordered agent-v events", async (context) => {
  const runtime = new DeterministicCodingRuntimeEngine();
  const app = await fixture(undefined, runtime);
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const sessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      mode: "ask",
      runtimeId: "codex",
      modelId: "gpt-5.6-sol",
      prompt: "Explain this project",
      attachments: [{ id: "project-file:src/index.ts", name: "index.ts", path: "src/index.ts" }],
    }),
  });
  assert.equal(sessionResponse.status, 201);
  const state = await waitForIdle(app.baseUrl);
  assert.equal(state.sessions.length, 1);
  assert.deepEqual(state.events.map((event) => event.sequence), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(state.events.filter((event) => event.actor === "agent").map((event) => event.title), [
    "The entry point is `src/index.ts`.",
  ]);
  assert.equal(state.events.some((event) => event.kind === "progress" && event.state === "running"), false);
  assert.equal(state.sessions[0]?.modelId, "gpt-5.6-sol");
  assert.equal(runtime.requests[0]?.runtimeModel, "gpt-5.6-sol");
  assert.deepEqual(runtime.requests[0]?.input.artifacts, [{
    id: "project-file:src/index.ts",
    uri: "vraxis-project:///src/index.ts",
    mediaType: "text/plain",
    title: "index.ts",
    metadata: { projectRelativePath: "src/index.ts" },
  }]);
  assert.equal(runtime.requests[0]?.input.artifacts?.[0]?.content, undefined);
  assert.deepEqual(state.events.find((event) => event.actor === "user")?.attachments, [{ path: "src/index.ts", id: "project-file:src/index.ts", name: "index.ts" }]);
  const replay = await fetch(`${app.baseUrl}/api/sessions/${state.sessions[0]?.id}/events?after=5`);
  const replayed = await replay.json() as { events: Array<{ sequence: number }> };
  assert.deepEqual(replayed.events.map((event) => event.sequence), [6, 7]);

  const followUp = await fetch(`${app.baseUrl}/api/sessions/${state.sessions[0]?.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "What imports it?",
      mode: "review",
      runtimeId: "codex",
      modelId: "gpt-5.6-terra",
    }),
  });
  assert.equal(followUp.status, 201);
  const continued = await waitForIdle(app.baseUrl);
  assert.equal(continued.events.filter((event) => event.actor === "user").length, 2);
  assert.equal(continued.events.filter((event) => event.actor === "agent").length, 2);
  assert.equal(continued.sessions[0]?.mode, "review");
  assert.equal(continued.sessions[0]?.modelId, "gpt-5.6-terra");
  assert.equal(runtime.requests[1]?.runtimeModel, "gpt-5.6-terra");
  assert.match(runtime.requests[1]?.input.instructions ?? "", /Review the engineer's requested area/);
  assert.deepEqual(runtime.requests[1]?.input.messages?.map((message) => message.role), ["user", "assistant"]);

  const newTask = await fetch(`${app.baseUrl}/api/projects/${project.id}/new-task`, { method: "POST" });
  assert.equal(newTask.status, 200);
  const freshTask = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    selectedSessionId?: string;
    sessions: unknown[];
    events: unknown[];
  };
  assert.equal(freshTask.selectedSessionId, undefined);
  assert.equal(freshTask.sessions.length, 1);
  assert.deepEqual(freshTask.events, []);

  const restored = await fetch(`${app.baseUrl}/api/sessions/${state.sessions[0]?.id}/select`, { method: "POST" });
  assert.equal(restored.status, 200);
  const restoredTask = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    selectedSessionId?: string;
    events: unknown[];
  };
  assert.equal(restoredTask.selectedSessionId, state.sessions[0]?.id);
  assert.ok(restoredTask.events.length > 0);
});

test("opens an interactive user shell in the selected task workspace", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const registered = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await registered.json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Open a terminal" }),
  });
  const session = await created.json() as { id: string };
  await waitForIdle(app.baseUrl);

  const opened = await fetch(`${app.baseUrl}/api/sessions/${session.id}/terminal-shell`, { method: "POST" });
  assert.equal(opened.status, 201);
  const prepared = await opened.json() as { run: { id: string; approvalId: string; purpose?: string; cwd: string } };
  assert.equal(prepared.run.purpose, "user-shell");
  assert.equal(prepared.run.cwd, ".");
  assert.match(prepared.run.approvalId, /^user-terminal:/);

  let run: { status: string; output: string; columns?: number; rows?: number } | undefined;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as {
      terminalRuns: Array<{ id: string; status: string; output: string; columns?: number; rows?: number }>;
    };
    run = evidence.terminalRuns.find((item) => item.id === prepared.run.id);
    if (run?.status === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(run?.status, "running");

  const reopened = await fetch(`${app.baseUrl}/api/sessions/${session.id}/terminal-shell`, { method: "POST" });
  assert.equal(reopened.status, 200);
  const reused = await reopened.json() as { run: { id: string } };
  assert.equal(reused.run.id, prepared.run.id);

  const streamAbort = new AbortController();
  context.after(() => streamAbort.abort());
  const streamed = await fetch(`${app.baseUrl}/api/terminal/${prepared.run.id}/stream`, { signal: streamAbort.signal });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get("content-type") ?? "", /text\/event-stream/);
  const reader = streamed.body!.getReader();
  const decoder = new TextDecoder();
  let streamText = "";
  const readUntil = async (pattern: RegExp): Promise<void> => {
    while (!pattern.test(streamText)) {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Terminal stream timed out.")), 1_000)),
      ]);
      if (result.done) break;
      streamText += decoder.decode(result.value, { stream: true });
    }
    assert.match(streamText, pattern);
  };
  await readUntil(/event: snapshot/);

  const resized = await fetch(`${app.baseUrl}/api/terminal/${prepared.run.id}/resize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ columns: 122, rows: 38 }),
  });
  assert.equal(resized.status, 200);
  const input = process.platform === "win32"
    ? "echo vraxis-terminal-ready\r\nexit\r\n"
    : "printf 'vraxis-terminal-ready\\n'\nexit\n";
  const written = await fetch(`${app.baseUrl}/api/terminal/${prepared.run.id}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: input }),
  });
  assert.equal(written.status, 200);
  await readUntil(/event: data[\s\S]*vraxis-terminal-ready/);
  streamAbort.abort();

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as {
      terminalRuns: Array<{ id: string; status: string; output: string; columns?: number; rows?: number }>;
    };
    run = evidence.terminalRuns.find((item) => item.id === prepared.run.id);
    if (run?.status === "success") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(run?.status, "success");
  assert.match(run?.output ?? "", /vraxis-terminal-ready/);
  assert.equal(run?.columns, 122);
  assert.equal(run?.rows, 38);
  const receipt = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/receipt`)).json() as {
    terminalRuns: Array<{ purpose?: string }>;
  };
  assert.deepEqual(receipt.terminalRuns, []);
});

test("discovers, attaches, persists, and applies agent-v skills", async (context) => {
  const runtime = new DeterministicCodingRuntimeEngine();
  const skillRoot = "/private/skills/ux-fundamentals";
  const app = await fixture(undefined, runtime, {
    discoverSkills: async (options) => {
      assert.equal(basename(options?.cwd ?? ""), "project");
      return {
        generatedAt: new Date().toISOString(),
        sources: [],
        unresolvedSources: [],
        skills: [{
          key: `${skillRoot}/SKILL.md`,
          id: "ux-fundamentals",
          name: "ux-fundamentals",
          description: "Product UX guidance for clear interaction flows.",
          version: "1.2.0",
          rootPath: skillRoot,
          manifestPath: `${skillRoot}/SKILL.md`,
          status: "found",
          agentVCompatible: true,
          runtimes: ["codex", "cursor"],
          exposures: [{ sourceId: "codex:user", runtimes: ["codex", "cursor"], scope: "user", kind: "directory" }],
          loaded: {
            rootPath: skillRoot,
            manifestPath: `${skillRoot}/SKILL.md`,
            scripts: [],
            references: [],
            assets: [],
            skill: {
              id: "ux-fundamentals",
              name: "ux-fundamentals",
              description: "Product UX guidance for clear interaction flows.",
              version: "1.2.0",
              instructions: "Start with the user's goal and preserve visible system status.",
              tools: [],
              trust: "local",
            },
          },
        }],
      };
    },
  });
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const bootstrap = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    skills: Array<{ id: string; name: string; description: string; version: string; scopes: string[]; runtimes: string[] }>;
  };
  assert.equal(bootstrap.skills.length, 1);
  assert.deepEqual(bootstrap.skills[0], {
    id: bootstrap.skills[0]?.id,
    name: "ux-fundamentals",
    description: "Product UX guidance for clear interaction flows.",
    version: "1.2.0",
    scopes: ["user"],
    runtimes: ["codex", "cursor"],
  });
  assert.doesNotMatch(JSON.stringify(bootstrap), /private\/skills/);
  const skillId = bootstrap.skills[0]?.id;
  assert.ok(skillId);

  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: project.id,
      mode: "ask",
      runtimeId: "codex",
      prompt: "Review the task flow",
      skillIds: [skillId],
    }),
  });
  assert.equal(created.status, 201);
  const state = await waitForIdle(app.baseUrl);
  const userEvent = state.events.find((event) => event.actor === "user") as typeof state.events[number] & {
    skills?: Array<{ id: string; name: string; version: string }>;
  };
  assert.deepEqual(userEvent.skills, [{ id: skillId, name: "ux-fundamentals", version: "1.2.0" }]);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /Start with the user's goal and preserve visible system status/);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /cannot grant tools, permissions, workspace writes, network access/);
  assert.deepEqual(runtime.requests[0]?.input.artifacts, [{
    id: `attached-skill:${skillId}`,
    uri: `vraxis-skill:///${skillId}/1.2.0`,
    mediaType: "text/markdown",
    title: "ux-fundamentals",
    content: "Start with the user's goal and preserve visible system status.",
    metadata: { skillId, version: "1.2.0" },
  }]);

  const unavailable = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Use missing skill", skillIds: ["missing"] }),
  });
  assert.equal(unavailable.status, 400);
  assert.match(await unavailable.text(), /no longer available/);
});

test("imports external files with colliding names and requires destination consent", async (context) => {
  const runtime = new DeterministicCodingRuntimeEngine();
  const app = await fixture(undefined, runtime);
  context.after(() => app.close());
  const outsideDirectory = await mkdtemp(join(tmpdir(), "vraxis-code-attachments-"));
  const outsideFile = join(outsideDirectory, "notes.txt");
  await writeFile(outsideFile, "outside workspace\n");
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };

  const imported = await Promise.all([
    fetch(`${app.baseUrl}/api/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-vraxis-file-name": encodeURIComponent("notes.txt") },
      body: await readFile(outsideFile),
    }),
    fetch(`${app.baseUrl}/api/attachments`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-vraxis-file-name": encodeURIComponent("notes.txt") },
      body: "same name, different file\n",
    }),
  ]).then((responses) => Promise.all(responses.map(async (response) => {
    assert.equal(response.status, 201);
    return response.json() as Promise<{
      id: string;
      name: string;
      path: string;
      source: "imported";
      mediaType: string;
      size: number;
    }>;
  })));
  assert.equal(imported[0]?.name, "notes.txt");
  assert.equal(imported[1]?.name, "notes.txt");
  assert.notEqual(imported[0]?.id, imported[1]?.id);
  assert.notEqual(imported[0]?.path, imported[1]?.path);
  if (process.platform !== "win32") {
    assert.equal((await stat(join(app.dataDirectory, "attachments"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(app.dataDirectory, "attachments", imported[0]!.path))).mode & 0o777, 0o600);
  }

  const request = {
    projectId: project.id,
    mode: "ask",
    runtimeId: "codex",
    prompt: "Compare the attached files",
    attachments: imported,
  };
  const unapproved = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(unapproved.status, 400);
  assert.match(await unapproved.text(), /Confirm the external files/);

  const approved = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...request,
      attachmentConsent: {
        attachmentIds: imported.map((item) => item.id),
        runtimeId: "codex",
        confirmed: true,
      },
    }),
  });
  assert.equal(approved.status, 201);
  await waitForIdle(app.baseUrl);
  assert.deepEqual(runtime.requests[0]?.input.artifacts?.map((item) => item.title), ["notes.txt", "notes.txt"]);
  assert.deepEqual(runtime.requests[0]?.input.artifacts?.map((item) => item.content), [
    "outside workspace\n",
    "same name, different file\n",
  ]);
  assert.ok(runtime.requests[0]?.input.artifacts?.every((item) => item.uri.startsWith("vraxis-attachment:///")));
  assert.ok(runtime.requests[0]?.input.artifacts?.every((item) => item.metadata?.imported === true));
  assert.equal((await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { sessions: unknown[] }).sessions.length, 1);
});

test("runs Plan read-only and rejects Build when the runtime cannot write workspaces", async (context) => {
  const runtime = new DeterministicCodingRuntimeEngine();
  const app = await fixture(undefined, runtime);
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };

  const planResponse = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "plan", runtimeId: "codex", prompt: "Plan the change" }),
  });
  assert.equal(planResponse.status, 201);
  const planMutation = await planResponse.json() as { mode: string; status: string; events: unknown[] };
  assert.equal(planMutation.mode, "plan");
  assert.equal(planMutation.status, "running");
  assert.ok(planMutation.events.length >= 2);
  await waitForIdle(app.baseUrl);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /produce a concrete implementation plan/);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /Repository comprehension, Project architecture/);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /Default tool requests for this mode: calculate, date-time, evidence-status, request-verification, list-directory/);
  assert.match(runtime.requests[0]?.input.instructions ?? "", /This mode is read-only/);
  assert.equal(runtime.requests[0]?.workspaceAccess, "read-only");

  const buildResponse = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "build", runtimeId: "codex", prompt: "Make the change" }),
  });
  assert.equal(buildResponse.status, 400);
  assert.match(await buildResponse.text(), /supports guarded isolated-workspace writes/);
  const state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as { sessions: unknown[] };
  assert.equal(state.sessions.length, 1);
});

test("retains governed tool and approval activity in the task timeline", async (context) => {
  class ActivityRuntime extends DeterministicCodingRuntimeEngine {
    override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
      const base = { runId: request.runId ?? crypto.randomUUID(), timestamp: new Date().toISOString(), scope: request.scope };
      await sink?.emit({ ...base, type: "tool.requested", toolCallId: "browser-call", toolName: "browser-navigate" });
      await sink?.emit({ ...base, type: "approval.requested", approvalId: "browser-approval", toolName: "browser-navigate", reason: "Open the requested preview." });
      await sink?.emit({ ...base, type: "approval.resolved", approvalId: "browser-approval", decision: "approved" });
      await sink?.emit({ ...base, type: "tool.completed", toolCallId: "browser-call", toolName: "browser-navigate", durationMs: 1250 });
      await sink?.emit({ ...base, type: "tool.requested", toolCallId: "read-call", toolName: "read-text" });
      await sink?.emit({ ...base, type: "tool.completed", toolCallId: "read-call", toolName: "read-text", durationMs: 24 });
      return super.run(request, sink);
    }
  }

  const app = await fixture(undefined, new ActivityRuntime());
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Open the preview" }),
  });
  assert.equal(created.status, 201);
  await waitForIdle(app.baseUrl);

  const state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    events: Array<{ kind: string; title: string; detail: string; state: string }>;
  };
  const activityShape = (event: { kind: string; title: string; detail: string; state: string }) => ({
    kind: event.kind,
    title: event.title,
    detail: event.detail,
    state: event.state,
  });
  assert.deepEqual(state.events.filter((event) => event.kind === "tool").map(activityShape), [
    {
      kind: "tool",
      title: "Browser · navigate",
      detail: "Completed in 1.3 seconds with a retained task receipt.",
      state: "complete",
    },
    {
      kind: "tool",
      title: "Exploring · read text",
      detail: "Completed in 24 ms with a retained task receipt.",
      state: "complete",
    },
  ]);
  assert.deepEqual(state.events.filter((event) => event.kind === "approval").map(activityShape), [{
    kind: "approval",
    title: "Approval · Browser · navigate",
    detail: "Approved. The agent can continue this exact action.",
    state: "complete",
  }]);
});

test("persists disclosed context compaction and attributable run usage", async (context) => {
  class ContextRuntime extends DeterministicCodingRuntimeEngine {
    override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
      const usage = {
        system: 120,
        tools: 240,
        transcript: 360,
        artifacts: 40,
        toolResults: 80,
        total: 840,
        budget: 1_000,
        remaining: 160,
        utilization: 0.84,
        estimated: true as const,
      };
      await sink?.emit({
        runId: request.runId ?? crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        scope: request.scope,
        type: "context.compacted",
        removedMessages: 3,
        disclosure: "Earlier messages were replaced by a continuity record.",
        usage,
      });
      const result = await super.run(request, sink);
      return { ...result, usage: { input: 900, output: 100, total: 1_000, context: usage, cost: { status: "included" } } };
    }
  }

  const app = await fixture(undefined, new ContextRuntime());
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect a long task" }),
  });
  assert.equal(created.status, 201);
  await waitForIdle(app.baseUrl);

  const state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    events: Array<{ kind: string; title: string; detail: string }>;
  };
  const telemetry = state.events.filter((event) => event.kind === "telemetry");
  assert.deepEqual(telemetry.map((event) => event.title), ["Context compacted", "Run usage"]);
  assert.match(telemetry[0]?.detail ?? "", /3 older messages were replaced/);
  assert.match(telemetry[0]?.detail ?? "", /tool results 80/);
  assert.match(telemetry[1]?.detail ?? "", /1,000 tokens · Included/);
});

test("runs Build inside an isolated worktree and returns exact change evidence", async (context) => {
  class EditingRuntime extends DeterministicCodingRuntimeEngine {
    override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
      assert.equal(request.workspaceAccess, "workspace-write");
      assert.ok(request.workspacePath);
      await writeFile(join(request.workspacePath, "src", "index.ts"), "export const ready = false;\nexport const built = true;\n");
      return super.run(request, sink);
    }
  }
  const runtime = new EditingRuntime();
  const app = await fixture(undefined, runtime, {
    discover: async () => [{
      id: "codex",
      name: "Codex",
      availability: "installed",
      detail: "Available",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "artifacts"],
    }, {
      id: "claude-code",
      name: "Claude Code",
      availability: "installed",
      detail: "Available",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      capabilities: ["structured-output", "local-workspace", "read-only-workspace", "artifacts"],
    }, {
      id: "cursor",
      name: "Cursor Agent",
      availability: "installed",
      detail: "Available without a governed write bridge",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      capabilities: ["structured-output", "local-workspace", "read-only-workspace", "artifacts"],
    }],
  });
  context.after(() => app.close());
  await git(app.project, "init", "-b", "main");
  await git(app.project, "config", "core.autocrlf", "false");
  await git(app.project, "config", "user.name", "Vraxis Test");
  await git(app.project, "config", "user.email", "test@vraxis.local");
  await git(app.project, "add", ".");
  await git(app.project, "commit", "-m", "Initial fixture");
  const sourceCommit = await git(app.project, "rev-parse", "HEAD");
  await writeFile(join(app.project, "src", "index.ts"), "export const ready = false;\n");
  await writeFile(join(app.project, "notes.md"), "Uncommitted project context\n");
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };

  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "build", runtimeId: "codex", prompt: "Set built to true" }),
  });
  assert.equal(created.status, 201);
  const mutation = await created.json() as { id: string; worktree: { id: string; path: string; branch: string; baseBranch: string; baseCommit: string } };
  assert.ok(mutation.worktree.path.startsWith(join(await realpath(app.dataDirectory), "worktrees", project.id)));
  assert.match(mutation.worktree.branch, /^vraxis\/set-built-to-true-/);
  assert.equal(mutation.worktree.baseBranch, "main");
  assert.notEqual(mutation.worktree.baseCommit, sourceCommit);
  assert.equal(await git(mutation.worktree.path, "rev-parse", "HEAD"), mutation.worktree.baseCommit);
  await waitForIdle(app.baseUrl);

  assert.equal(await readFile(join(app.project, "src", "index.ts"), "utf8"), "export const ready = false;\n");
  assert.equal(await readFile(join(mutation.worktree.path, "notes.md"), "utf8"), "Uncommitted project context\n");
  assert.equal(await readFile(join(mutation.worktree.path, "src", "index.ts"), "utf8"), "export const ready = false;\nexport const built = true;\n");
  assert.equal(runtime.requests[0]?.workspacePath, mutation.worktree.path);
  assert.equal(runtime.requests[0]?.workspaceAccess, "workspace-write");
  assert.match(runtime.requests[0]?.input.instructions ?? "", /isolated worktree/);

  const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/workspace`)).json() as {
    changes: Array<{ path: string; status: string }>;
    files: Array<{ path: string; status?: string }>;
  };
  assert.deepEqual(evidence.changes, [{ path: "src/index.ts", status: "modified" }]);
  assert.equal(evidence.files.find((file) => file.path === "src/index.ts")?.status, "modified");
  const diffResponse = await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/diff?path=${encodeURIComponent("src/index.ts")}`);
  assert.equal(diffResponse.status, 200);
  const diff = await diffResponse.json() as {
    path: string;
    patch: string;
    additions: number;
    deletions: number;
    binary: boolean;
    partialSelection: boolean;
    hunks: Array<{ id: string; header: string; additions: number; deletions: number }>;
  };
  assert.equal(diff.path, "src/index.ts");
  assert.match(diff.patch, /\+export const built = true;/);
  assert.doesNotMatch(diff.patch, /-export const ready = true;/);
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions, binary: diff.binary }, { additions: 1, deletions: 0, binary: false });
  assert.equal(diff.partialSelection, true);
  assert.equal(diff.hunks.length, 1);
  const preview = await (await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/file?path=${encodeURIComponent("src/index.ts")}`)).json() as { content: string };
  assert.equal(preview.content, "export const ready = false;\nexport const built = true;\n");
  assert.equal((await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/file?path=${encodeURIComponent("../secret.txt")}`)).status, 400);

  const applyRequest = await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/worktree/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hunks: [{ path: "src/index.ts", hunkIds: [diff.hunks[0]!.id] }] }),
  });
  assert.equal(applyRequest.status, 202);
  const applyApproval = await applyRequest.json() as { approval: { id: string; source: string; state: string; scope: string } };
  assert.equal(applyApproval.approval.source, "worktree");
  assert.equal(applyApproval.approval.state, "pending");
  assert.match(applyApproval.approval.scope, /1 hunk/);
  assert.equal(await readFile(join(app.project, "src", "index.ts"), "utf8"), "export const ready = false;\n");

  const applyDecision = await fetch(`${app.baseUrl}/api/approvals/${applyApproval.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(applyDecision.status, 200);
  let appliedState: {
    sessions: Array<{ id: string; worktree?: { status: string; checkpointCommit?: string; appliedAt?: string } }>;
    events: Array<{ title: string }>;
    approvals: Array<{ id: string; state: string }>;
  } | undefined;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    appliedState = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as typeof appliedState;
    if (appliedState?.sessions[0]?.worktree?.status === "applied") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(appliedState?.sessions[0]?.worktree?.status, "applied");
  assert.match(appliedState?.sessions[0]?.worktree?.checkpointCommit ?? "", /^[a-f0-9]{40,64}$/);
  assert.ok(appliedState?.sessions[0]?.worktree?.appliedAt);
  assert.ok(appliedState?.events.some((event) => event.title === "Changes applied"));
  assert.equal(appliedState?.approvals.find((item) => item.id === applyApproval.approval.id)?.state, "completed");
  assert.equal(await readFile(join(app.project, "src", "index.ts"), "utf8"), "export const ready = false;\nexport const built = true;\n");
  assert.equal(await readFile(join(app.project, "notes.md"), "utf8"), "Uncommitted project context\n");
  assert.equal(await git(mutation.worktree.path, "rev-parse", "HEAD"), appliedState?.sessions[0]?.worktree?.checkpointCommit);
  const receiptResponse = await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/receipt`);
  assert.equal(receiptResponse.status, 200);
  const receipt = await receiptResponse.json() as {
    kind: string;
    version: number;
    session: { id: string; mode: string };
    changes: Array<{ path: string }>;
    approvals: Array<{ id: string; state: string }>;
    activity: Array<{ title: string }>;
  };
  assert.equal(receipt.kind, "vraxis.task-receipt");
  assert.equal(receipt.version, 1);
  assert.equal(receipt.session.id, mutation.id);
  assert.equal(receipt.session.mode, "build");
  assert.deepEqual(receipt.changes.map((item) => item.path), ["src/index.ts"]);
  assert.equal(receipt.approvals.find((item) => item.id === applyApproval.approval.id)?.state, "completed");
  assert.ok(receipt.activity.some((item) => item.title === "Changes applied"));
  assert.equal((await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/worktree/apply`, { method: "POST" })).status, 400);

  const appliedFollowUp = await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "build", runtimeId: "codex", prompt: "Make another edit" }),
  });
  assert.equal(appliedFollowUp.status, 201);
  const continuedBuild = await appliedFollowUp.json() as {
    id: string;
    worktree: { id: string; path: string; status: string; baseCommit: string };
    worktreeHistory: Array<{ id: string; branch: string; status: string; checkpointCommit?: string }>;
  };
  assert.equal(continuedBuild.id, mutation.id);
  assert.equal(continuedBuild.worktree.status, "active");
  assert.notEqual(continuedBuild.worktree.id, mutation.worktree.id);
  assert.equal(continuedBuild.worktreeHistory.length, 1);
  assert.equal(continuedBuild.worktreeHistory[0]?.status, "applied");
  assert.equal(continuedBuild.worktreeHistory[0]?.checkpointCommit, appliedState?.sessions[0]?.worktree?.checkpointCommit);
  const continuedState = await waitForIdle(app.baseUrl);
  assert.equal(await readFile(join(continuedBuild.worktree.path, "src", "index.ts"), "utf8"), "export const ready = false;\nexport const built = true;\n");
  assert.equal(continuedState.events.filter((event) => event.actor === "user").length, 2);
  assert.ok(continuedState.events.some((event) => event.title === "Build continued"));
  assert.equal(runtime.requests[1]?.workspacePath, continuedBuild.worktree.path);

  const unsupported = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "build", runtimeId: "cursor", prompt: "Try unsupported Build" }),
  });
  assert.equal(unsupported.status, 400);
  assert.match(await unsupported.text(), /supports guarded isolated-workspace writes/);
});

test("runs Build from a repository without a first commit", async (context) => {
  class EditingRuntime extends DeterministicCodingRuntimeEngine {
    override async run<T>(request: CodingRuntimeRequest<T>, sink?: EventSink): Promise<CodingRuntimeResult<T>> {
      assert.equal(request.workspaceAccess, "workspace-write");
      assert.ok(request.workspacePath);
      const current = await readFile(join(request.workspacePath, "src", "index.ts"), "utf8");
      await writeFile(join(request.workspacePath, "src", "index.ts"), `${current}export const built = true;\n`);
      return super.run(request, sink);
    }
  }
  const runtime = new EditingRuntime();
  const app = await fixture(undefined, runtime, {
    discover: async () => [{
      id: "codex",
      name: "Codex",
      availability: "installed",
      detail: "Available",
      acceptsCustomModel: true,
      models: [],
      kind: "local-cli",
      capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "artifacts"],
    }],
  });
  context.after(() => app.close());
  await git(app.project, "init", "-b", "main");
  await git(app.project, "config", "core.autocrlf", "false");
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };

  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "build", runtimeId: "codex", prompt: "Build before the first commit" }),
  });
  assert.equal(created.status, 201);
  const mutation = await created.json() as { id: string; worktree: { path: string; branch: string; baseBranch: string; baseCommit: string } };
  assert.equal(mutation.worktree.baseBranch, "main");
  assert.match(mutation.worktree.baseCommit, /^[a-f0-9]{40,64}$/);
  assert.equal(await git(mutation.worktree.path, "rev-parse", "HEAD"), mutation.worktree.baseCommit);
  await waitForIdle(app.baseUrl);

  assert.equal(await readFile(join(app.project, "src", "index.ts"), "utf8"), "export const ready = true;\n");
  assert.equal(await readFile(join(mutation.worktree.path, "src", "index.ts"), "utf8"), "export const ready = true;\nexport const built = true;\n");
  const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/workspace`)).json() as {
    changes: Array<{ path: string; status: string }>;
  };
  assert.deepEqual(evidence.changes, [{ path: "src/index.ts", status: "modified" }]);
  const diff = await (await fetch(`${app.baseUrl}/api/sessions/${mutation.id}/diff?path=${encodeURIComponent("src/index.ts")}`)).json() as {
    patch: string;
    additions: number;
    deletions: number;
  };
  assert.match(diff.patch, /\+export const built = true;/);
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions }, { additions: 1, deletions: 0 });
  await assert.rejects(execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: app.project, encoding: "utf8" }));
});

test("stops and resumes a running task without losing its history", async (context) => {
  const app = await fixture(undefined, new InterruptibleCodingRuntimeEngine());
  context.after(() => app.close());
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect the project" }),
  });
  const session = await created.json() as { id: string };
  assert.equal(created.status, 201);

  const stopped = await fetch(`${app.baseUrl}/api/sessions/${session.id}/interrupt`, { method: "POST" });
  assert.equal(stopped.status, 200);
  let state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as {
    sessions: Array<{ status: string }>;
    events: Array<{ title: string }>;
  };
  assert.equal(state.sessions[0]?.status, "interrupted");
  assert.equal(state.events.filter((event) => event.title === "Inspect the project").length, 1);
  assert.equal(state.events.at(-1)?.title, "Task stopped");

  const resumed = await fetch(`${app.baseUrl}/api/sessions/${session.id}/resume`, { method: "POST" });
  assert.equal(resumed.status, 202);
  state = await (await fetch(`${app.baseUrl}/api/bootstrap`)).json() as typeof state;
  assert.equal(state.sessions[0]?.status, "running");
  assert.equal(state.events.filter((event) => event.title === "Inspect the project").length, 1);
  await fetch(`${app.baseUrl}/api/sessions/${session.id}/interrupt`, { method: "POST" });
});

test("queues a follow-up without interrupting the active turn", async (context) => {
  const engine = new ControlledFirstRunEngine();
  const app = await fixture(undefined, engine);
  context.after(() => app.close());
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const created = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect the project" }),
  });
  const session = await created.json() as { id: string };
  await engine.firstStarted;

  const steered = await fetch(`${app.baseUrl}/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Then inspect the tests", delivery: "queue" }),
  });
  assert.equal(steered.status, 202);
  const accepted = await steered.json() as { status: string; steering?: { state: string; pendingCount: number } };
  assert.equal(accepted.status, "running");
  assert.deepEqual(accepted.steering && { state: accepted.steering.state, pendingCount: accepted.steering.pendingCount }, { state: "queued", pendingCount: 1 });
  assert.deepEqual(engine.prompts, ["Inspect the project"]);

  engine.releaseFirst();
  const state = await waitForIdle(app.baseUrl);
  assert.deepEqual(engine.prompts, ["Inspect the project", "Then inspect the tests"]);
  const steeredEvent = state.events.find((event) => event.title === "Then inspect the tests") as typeof state.events[number] & { steering?: { state: string } };
  assert.equal(steeredEvent.steering?.state, "handled");
});

test("interrupts the active turn and immediately applies a redirected instruction", async (context) => {
  const engine = new ControlledFirstRunEngine();
  const app = await fixture(undefined, engine);
  context.after(() => app.close());
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const session = await (await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect the project" }),
  })).json() as { id: string };
  await engine.firstStarted;

  const redirected = await fetch(`${app.baseUrl}/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Stop and inspect the parser first", delivery: "redirect" }),
  });
  assert.equal(redirected.status, 202);
  const state = await waitForIdle(app.baseUrl);
  assert.deepEqual(engine.prompts, ["Inspect the project", "Stop and inspect the parser first"]);
  assert.ok(state.events.some((event) => event.title === "Direction updated"));
  const steeredEvent = state.events.find((event) => event.title === "Stop and inspect the parser first") as typeof state.events[number] & { steering?: { delivery: string; state: string } };
  assert.deepEqual(steeredEvent.steering, { delivery: "redirect", state: "handled" });
});

test("resumes the oldest queued instruction once after a manual stop", async (context) => {
  const engine = new ControlledFirstRunEngine();
  const app = await fixture(undefined, engine);
  context.after(() => app.close());
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const session = await (await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect the project" }),
  })).json() as { id: string };
  await engine.firstStarted;
  await fetch(`${app.baseUrl}/api/sessions/${session.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Inspect the tests next", delivery: "queue" }),
  });
  await fetch(`${app.baseUrl}/api/sessions/${session.id}/interrupt`, { method: "POST" });

  const resumed = await fetch(`${app.baseUrl}/api/sessions/${session.id}/resume`, { method: "POST" });
  assert.equal(resumed.status, 202);
  await waitForIdle(app.baseUrl);
  assert.deepEqual(engine.prompts, ["Inspect the project", "Inspect the tests next"]);
});

test("requires a product approval before running a terminal command", async (context) => {
  const app = await fixture();
  context.after(() => app.close());
  const authority = await fetch(`${app.baseUrl}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authorityMode: "full-access" }),
  });
  assert.equal(authority.status, 200);
  const projectResponse = await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  });
  const project = await projectResponse.json() as { id: string };
  const sessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect the project" }),
  });
  const session = await sessionResponse.json() as { id: string };
  await waitForIdle(app.baseUrl);

  const requested = await fetch(`${app.baseUrl}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, command: "node -e \"console.log('approved')\"" }),
  });
  assert.equal(requested.status, 202);
  const request = await requested.json() as { approval: { id: string; state: string }; run: { status: string } };
  assert.equal(request.approval.state, "pending");
  assert.equal(request.run.status, "pending");

  const decision = await fetch(`${app.baseUrl}/api/approvals/${request.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve", duration: "project" }),
  });
  assert.equal(decision.status, 200);
  let evidence: { approvals: Array<{ state: string }>; terminalRuns: Array<{ status: string; output: string }> } | undefined;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as typeof evidence;
    if (evidence?.terminalRuns[0]?.status === "success" && evidence.approvals[0]?.state === "completed") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(evidence?.terminalRuns[0]?.status, "success");
  assert.match(evidence?.terminalRuns[0]?.output ?? "", /approved/);
  assert.equal(evidence?.approvals[0]?.state, "completed");

  const ruleResponse = await fetch(`${app.baseUrl}/api/approval-rules`);
  assert.equal(ruleResponse.status, 200);
  const activeRules = await ruleResponse.json() as { rules: Array<{ id: string; projectId: string; effect: string; scope: string }> };
  assert.equal(activeRules.rules.length, 1);
  assert.equal(activeRules.rules[0]?.projectId, project.id);
  assert.equal(activeRules.rules[0]?.effect, "allow");
  assert.match(activeRules.rules[0]?.scope ?? "", /console\.log/);

  const auditResponse = await fetch(`${app.baseUrl}/api/approval-rules/audit`);
  assert.equal(auditResponse.status, 200);
  assert.match(auditResponse.headers.get("content-type") ?? "", /^application\/vnd\.vraxis\.approval-policy-audit\+json/);
  const audit = await auditResponse.json() as { kind: string; summary: { active: number; allowed: number } };
  assert.equal(audit.kind, "vraxis.approval-policy-audit");
  assert.deepEqual(audit.summary, { active: 1, revoked: 0, allowed: 1, denied: 0 });

  const revoked = await fetch(`${app.baseUrl}/api/approval-rules/${activeRules.rules[0]!.id}`, { method: "DELETE" });
  assert.equal(revoked.status, 200);
  const afterRevoke = await (await fetch(`${app.baseUrl}/api/approval-rules`)).json() as { rules: unknown[] };
  assert.equal(afterRevoke.rules.length, 0);

  const escaped = await fetch(`${app.baseUrl}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, command: "pwd", cwd: "../outside" }),
  });
  assert.equal(escaped.status, 400);
});

test("runs a project-owned verification recipe through approvals and retains its proof", async (context) => {
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), {
    projectInspector: async (rootPath) => ({
      schemaVersion: 1,
      rootPath,
      projectName: "verified-project",
      projectKind: "single-package",
      packageManager: { id: "npm", name: "npm", lockfile: "package-lock.json" },
      ecosystems: [{ id: "javascript", label: "JavaScript / TypeScript", manifest: "package.json" }],
      frameworks: [],
      verificationChecks: [{
        id: "javascript:check",
        title: "Project check",
        category: "check",
        command: process.execPath,
        args: ["-e", "console.log('discovered-check-should-not-run')"],
        cwd: ".",
        required: true,
        timeoutMs: 10_000,
        source: "package.json#scripts.check",
      }],
      devServers: [],
      issues: [],
      ok: true,
    }),
  });
  await mkdir(join(app.project, ".vraxis"), { recursive: true });
  await writeFile(join(app.project, ".vraxis", "verify.json"), JSON.stringify({
    schemaVersion: 1,
    checks: [{
      id: "project:check",
      title: "Project contract",
      category: "check",
      command: process.execPath,
      args: ["-e", "console.log('verification-ready')"],
      required: true,
      timeoutMs: 10_000,
    }],
  }));
  context.after(() => app.close());
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const doctor = await (await fetch(`${app.baseUrl}/api/projects/${project.id}/doctor`)).json() as { projectName: string; verificationChecks: Array<{ id: string }>; verificationSource: { kind: string; path?: string } };
  assert.equal(doctor.projectName, "verified-project");
  assert.equal(doctor.verificationChecks.length, 1);
  assert.equal(doctor.verificationChecks[0]?.id, "project:check");
  assert.deepEqual(doctor.verificationSource, { kind: "project", path: ".vraxis/verify.json", browserRequired: false });
  const sessionResponse = await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Inspect before verification" }),
  });
  const session = await sessionResponse.json() as { id: string };
  await waitForIdle(app.baseUrl);

  const started = await fetch(`${app.baseUrl}/api/sessions/${session.id}/verifications`, { method: "POST" });
  assert.equal(started.status, 202);
  const scheduled = await started.json() as { run: { id: string; state: string; recipeFingerprint: string }; approval: { id: string } };
  assert.equal(scheduled.run.state, "running");
  assert.match(scheduled.run.recipeFingerprint, /^[0-9a-f]{64}$/);
  const approved = await fetch(`${app.baseUrl}/api/approvals/${scheduled.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(approved.status, 200);

  let evidence: { verificationRuns?: Array<{ state: string; checks: Array<{ state: string; terminalRunId?: string }> }>; terminalRuns: Array<{ output: string }> } | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as typeof evidence;
    if (evidence?.verificationRuns?.[0]?.state === "passed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(evidence?.verificationRuns?.[0]?.state, "passed");
  assert.equal(evidence?.verificationRuns?.[0]?.checks[0]?.state, "passed");
  assert.match(evidence?.terminalRuns[0]?.output ?? "", /verification-ready/);

  const receipt = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/receipt`)).json() as { verificationRuns?: Array<{ id: string; state: string }> };
  assert.equal(receipt.verificationRuns?.[0]?.id, scheduled.run.id);
  assert.equal(receipt.verificationRuns?.[0]?.state, "passed");

  const signedResponse = await fetch(`${app.baseUrl}/api/sessions/${session.id}/proof.json`);
  assert.equal(signedResponse.status, 200);
  assert.match(signedResponse.headers.get("content-type") ?? "", /^application\/vnd\.vraxis\.task-proof\+json/);
  assert.match(signedResponse.headers.get("content-disposition") ?? "", /project-.*-proof\.json/);
  const signedProof = await signedResponse.json() as TaskProofEnvelopeV1;
  assert.equal(signedProof.deepLink, `vraxis-code://task/${session.id}`);
  assert.ok(signedProof.evidenceLinks?.some((item) => item.kind === "terminal" && item.target === evidence?.verificationRuns?.[0]?.checks[0]?.terminalRunId));
  assert.ok(signedProof.evidenceLinks?.some((item) => item.kind === "approval" && item.target === scheduled.approval.id));
  assert.equal(verifyTaskProof(signedProof), true);
  assert.doesNotMatch(JSON.stringify(signedProof), /PRIVATE KEY/);

  const understandResponse = await fetch(`${app.baseUrl}/api/sessions/${session.id}/understand.json`);
  assert.equal(understandResponse.status, 200);
  assert.match(understandResponse.headers.get("content-type") ?? "", /^application\/vnd\.vraxis\.understand\+json/);
  assert.match(understandResponse.headers.get("content-disposition") ?? "", /project-.*-understand\.json/);
  const understanding = await understandResponse.json() as UnderstandArtifactEnvelopeV1;
  assert.equal(verifyUnderstandArtifact(understanding), true);
  assert.equal(understanding.sourceProof.keyId, understanding.integrity.keyId);
  assert.equal(understanding.verdict.state, "verified");
  assert.ok(understanding.claims.some((claim) => claim.id === "claim-verification"));
  assert.doesNotMatch(JSON.stringify(understanding), /verification-ready|PRIVATE KEY/);

  const proofResponse = await fetch(`${app.baseUrl}/api/sessions/${session.id}/receipt.html`);
  assert.equal(proofResponse.status, 200);
  assert.match(proofResponse.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(proofResponse.headers.get("content-disposition") ?? "", /project-.*-proof\.html/);
  assert.match(proofResponse.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const proofHtml = await proofResponse.text();
  assert.match(proofHtml, /Every required service, project check, and browser proof passed/);
  assert.match(proofHtml, /Signed locally with Ed25519/);
  assert.match(proofHtml, new RegExp(`vraxis-code://task/${session.id}`));
  assert.match(proofHtml, /evidence=terminal&amp;target=/);
  assert.match(proofHtml, /evidence=approval&amp;target=/);

  const rerunResponse = await fetch(`${app.baseUrl}/api/verifications/${scheduled.run.id}/rerun`, { method: "POST" });
  assert.equal(rerunResponse.status, 202);
  const rerun = await rerunResponse.json() as { run: { id: string; state: string; recipeFingerprint: string; rerunOfId?: string }; approval: { id: string } };
  assert.notEqual(rerun.run.id, scheduled.run.id);
  assert.equal(rerun.run.rerunOfId, scheduled.run.id);
  assert.equal(rerun.run.recipeFingerprint, scheduled.run.recipeFingerprint);
  assert.equal(rerun.run.state, "running");
  const rerunApproved = await fetch(`${app.baseUrl}/api/approvals/${rerun.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(rerunApproved.status, 200);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as typeof evidence;
    if (evidence?.verificationRuns?.[0]?.state === "passed") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(evidence?.verificationRuns?.[0]?.state, "passed");
});

test("starts a declared service, proves loopback health, and tears it down after verification", async (context) => {
  const port = await freeLoopbackPort();
  const app = await fixture();
  context.after(() => app.close());
  await mkdir(join(app.project, ".vraxis"), { recursive: true });
  await writeFile(join(app.project, ".vraxis", "verify.json"), JSON.stringify({
    schemaVersion: 1,
    services: [{
      id: "web:preview",
      title: "Preview server",
      command: process.execPath,
      args: [
        "-e",
        `require('node:http').createServer((_request,response)=>{response.statusCode=204;response.end()}).listen(${port},'127.0.0.1')`,
      ],
      health: { url: `http://127.0.0.1:${port}/health`, expectedStatus: 204, timeoutMs: 10_000, intervalMs: 100 },
    }],
  }));
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const session = await (await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Verify the preview" }),
  })).json() as { id: string };
  await waitForIdle(app.baseUrl);

  const started = await fetch(`${app.baseUrl}/api/sessions/${session.id}/verifications`, { method: "POST" });
  assert.equal(started.status, 202);
  const scheduled = await started.json() as { run: { id: string; services: Array<{ state: string }> }; approval: { id: string; title: string } };
  assert.equal(scheduled.approval.title, "Start service · Preview server");
  assert.equal(scheduled.run.services[0]?.state, "awaiting-approval");
  const decision = await fetch(`${app.baseUrl}/api/approvals/${scheduled.approval.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(decision.status, 200);

  let evidence: {
    approvals: Array<{ id: string; state: string }>;
    terminalRuns: Array<{ status: string }>;
    verificationRuns: Array<{ state: string; services: Array<{ state: string; lastHealthStatus?: number; healthAttempts: number }> }>;
  } | undefined;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as typeof evidence;
    if (evidence?.verificationRuns[0]?.state === "passed" && evidence.terminalRuns[0]?.status === "interrupted") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(evidence?.verificationRuns[0]?.state, "passed");
  assert.equal(evidence?.verificationRuns[0]?.services[0]?.state, "stopped");
  assert.equal(evidence?.verificationRuns[0]?.services[0]?.lastHealthStatus, 204);
  assert.ok((evidence?.verificationRuns[0]?.services[0]?.healthAttempts ?? 0) >= 1);
  assert.equal(evidence?.approvals.find((item) => item.id === scheduled.approval.id)?.state, "completed");
  assert.equal(evidence?.terminalRuns[0]?.status, "interrupted");
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) }));

  const receipt = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/receipt`)).json() as {
    verificationRuns: Array<{ services: Array<{ id: string; state: string }> }>;
  };
  assert.deepEqual(receipt.verificationRuns[0]?.services.map((item) => ({ id: item.id, state: item.state })), [
    { id: "web:preview", state: "stopped" },
  ]);
});

test("evaluates project browser assertions against captured visible evidence", async (context) => {
  const pageServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Acceptance Preview</title><main><h1>Ready to ship</h1><p>Visible browser contract</p></main>");
  });
  await new Promise<void>((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
  const address = pageServer.address();
  if (!address || typeof address === "string") throw new Error("Acceptance page did not start.");
  const target = `http://127.0.0.1:${address.port}/review`;
  const browserRoot = await mkdtemp(join(tmpdir(), "vraxis-assertion-browser-"));
  const browserWorkspace = new BrowserWorkspace(browserRoot);
  const app = await fixture(undefined, new DeterministicCodingRuntimeEngine(), { browserWorkspace });
  context.after(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) => pageServer.close((error) => error ? reject(error) : resolve()));
  });
  await mkdir(join(app.project, ".vraxis"), { recursive: true });
  await writeFile(join(app.project, ".vraxis", "verify.json"), JSON.stringify({
    schemaVersion: 1,
    checks: [{ id: "check", command: process.execPath, args: ["-e", "process.exit(0)"] }],
    browser: {
      required: true,
      url: target,
      assertions: [
        { id: "route", title: "Review route", kind: "url", value: target },
        { id: "title", title: "Acceptance title", kind: "title", value: "acceptance preview" },
        { id: "copy", title: "Ready state", kind: "text", value: "Ready to ship", caseSensitive: true },
      ],
      visual: { baseline: "test-baselines/acceptance.png", maxDiffRatio: 0.01 },
    },
  }));
  const project = await (await fetch(`${app.baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: app.project }),
  })).json() as { id: string };
  const session = await (await fetch(`${app.baseUrl}/api/sessions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, mode: "ask", runtimeId: "codex", prompt: "Verify browser acceptance" }),
  })).json() as { id: string };
  await waitForIdle(app.baseUrl);
  await browserWorkspace.perform({ sessionId: session.id, action: "navigate", target });
  await mkdir(join(app.project, "test-baselines"), { recursive: true });
  await copyFile(browserWorkspace.screenshotPath(session.id), join(app.project, "test-baselines", "acceptance.png"));

  const scheduled = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/verifications`, { method: "POST" })).json() as {
    run: { id: string };
    approval: { id: string };
  };
  await fetch(`${app.baseUrl}/api/approvals/${scheduled.approval.id}/decision`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }),
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as { verificationRuns: Array<{ state: string }> };
    if (evidence.verificationRuns[0]?.state === "needs-browser") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const navigation = await (await fetch(`${app.baseUrl}/api/browser/actions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: session.id, action: "navigate", target }),
  })).json() as { browser: { url: string; actions: Array<{ actor?: string }> } };
  assert.equal(navigation.browser.url, target);
  assert.equal(navigation.browser.actions[0]?.actor, "user");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const evidence = await (await fetch(`${app.baseUrl}/api/sessions/${session.id}/live-evidence`)).json() as {
      browser?: { url: string; snapshot: string; actions: Array<{ actor?: string }> };
    };
    const userActionRecorded = evidence.browser?.actions.some((item) => item.actor === "user") ?? false;
    if (userActionRecorded && evidence.browser?.url === target && evidence.browser.snapshot.includes("Ready to ship")) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const proofResponse = await fetch(`${app.baseUrl}/api/verifications/${scheduled.run.id}/browser`, { method: "POST" });
  const proofBody = await proofResponse.text();
  assert.equal(proofResponse.status, 200, proofBody);
  const proof = JSON.parse(proofBody) as {
    run: {
      state: string;
      browserAssertions: Array<{ id: string; state: string; actual?: string }>;
      visual?: { state: string; diffRatio?: number; diffAvailable?: boolean };
    };
  };
  assert.equal(proof.run.state, "passed");
  assert.deepEqual(proof.run.browserAssertions.map((item) => ({ id: item.id, state: item.state })), [
    { id: "route", state: "passed" },
    { id: "title", state: "passed" },
    { id: "copy", state: "passed" },
  ]);
  assert.match(proof.run.browserAssertions.find((item) => item.id === "copy")?.actual ?? "", /Ready to ship/);
  assert.equal(proof.run.visual?.state, "passed");
  assert.ok((proof.run.visual?.diffRatio ?? 1) <= 0.01);
  assert.equal(proof.run.visual?.diffAvailable, false);
});
