import assert from "node:assert/strict";
import test from "node:test";
import { discoverRuntimes, parseLineModelCatalog } from "../src/runtimes/runtime-discovery.js";

test("normalizes line-oriented harness model catalogs", () => {
  assert.deepEqual(parseLineModelCatalog(`
    openai/gpt-5.6-sol
    - anthropic/claude-opus-4.1
    openai/gpt-5.6-sol
  `), [
    { id: "openai/gpt-5.6-sol", name: "openai/gpt-5.6-sol", availability: "available" },
    { id: "anthropic/claude-opus-4.1", name: "anthropic/claude-opus-4.1", availability: "available" },
  ]);
});

test("ignores prose in harness model output", () => {
  assert.deepEqual(parseLineModelCatalog("Choose a model from the list below\nNo models configured"), []);
});

test("maps the shared agent-v inventory without reimplementing harness discovery", async () => {
  const runtimes = await discoverRuntimes({
    discovery: {
      async list() {
        return [{
          id: "cursor",
          name: "Cursor Agent",
          readiness: { runtimeId: "cursor", availability: "installed" as const, verification: "unverified" as const, version: "Cursor Agent 2026.8", detail: "Detected through Cursor Desktop." },
          command: { command: "/Applications/Cursor.app/bin/cursor", argsPrefix: ["agent"], source: "desktop-app" as const, version: "Cursor Agent 2026.8" },
          application: { path: "/Applications/Cursor.app" },
          authentication: "authenticated" as const,
          authenticationDetail: "Cursor Agent reports an active login.",
          models: [{ id: "auto", name: "Auto", availability: "available" as const, isDefault: true }],
          modelDiscovery: "automatic" as const,
          update: { status: "unknown" as const, detail: "Managed by Cursor." },
          maintenanceActions: [{ id: "authenticate" as const, label: "Sign in to Cursor Agent", detail: "Prepare sign in.", kind: "command" as const, executable: "/Applications/Cursor.app/bin/cursor", args: ["agent", "login"], requiresNetwork: true }],
          checkedAt: "2026-08-30T12:00:00.000Z",
        }];
      },
    },
  });
  assert.equal(runtimes[0]?.executable, "/Applications/Cursor.app/bin/cursor agent");
  assert.equal(runtimes[0]?.applicationPath, "/Applications/Cursor.app");
  assert.equal(runtimes[0]?.models[0]?.id, "auto");
  assert.equal(runtimes[0]?.authentication, "authenticated");
  assert.deepEqual(runtimes[0]?.maintenanceActions?.[0]?.arguments, ["agent", "login"]);
  assert.ok(runtimes[0]?.capabilities?.includes("read-only-workspace"));
  assert.ok(runtimes[0]?.capabilities?.includes("workspace-write"));
  assert.ok(runtimes[0]?.capabilities?.includes("mcp-tools"));
});

test("advertises Build only when the harness can use governed tools with native execution disabled", async () => {
  const [runtime] = await discoverRuntimes({
    discovery: {
      async list() {
        return [{
          id: "codex",
          name: "Codex CLI",
          readiness: { runtimeId: "codex", availability: "installed" as const, verification: "ready" as const, detail: "Ready." },
          authentication: "authenticated" as const,
          models: [],
          modelDiscovery: "automatic" as const,
          update: { status: "current" as const },
          maintenanceActions: [],
          checkedAt: "2026-08-30T12:00:00.000Z",
        }];
      },
    },
  });
  assert.ok(runtime?.capabilities?.includes("workspace-write"));
  assert.ok(runtime?.capabilities?.includes("mcp-tools"));
});

test("advertises governed Build for Claude's strict MCP adapter", async () => {
  const [runtime] = await discoverRuntimes({
    discovery: { async list() { return [{
      id: "claude-code",
      name: "Claude Code",
      readiness: { runtimeId: "claude-code", availability: "installed" as const, verification: "ready" as const, detail: "Ready." },
      authentication: "authenticated" as const,
      authenticationDetail: "Authenticated.",
      models: [],
      modelDiscovery: "aliases" as const,
      update: { status: "unknown" as const, detail: "Managed by Claude Code." },
      maintenanceActions: [],
      checkedAt: "2026-08-31T12:00:00.000Z",
    }]; } },
  });
  assert.ok(runtime?.capabilities?.includes("workspace-write"));
  assert.ok(runtime?.capabilities?.includes("mcp-tools"));
});

test("advertises governed Build only for OpenCode versions with a verified isolation contract", async () => {
  const inventory = (version: string) => ({
    id: "opencode",
    name: "OpenCode",
    readiness: { runtimeId: "opencode", availability: "installed" as const, verification: "ready" as const, version, detail: "Ready." },
    authentication: "authenticated" as const,
    authenticationDetail: "Authenticated.",
    models: [],
    modelDiscovery: "automatic" as const,
    update: { status: "current" as const },
    maintenanceActions: [],
    checkedAt: "2026-08-31T12:00:00.000Z",
  });
  const [stable] = await discoverRuntimes({ discovery: { async list() { return [inventory("opencode 1.15.10")]; } } });
  const [future] = await discoverRuntimes({ discovery: { async list() { return [inventory("opencode 2.0.0")]; } } });
  assert.ok(stable?.capabilities?.includes("workspace-write"));
  assert.ok(stable?.capabilities?.includes("mcp-tools"));
  assert.equal(future?.capabilities?.includes("workspace-write"), false);
  assert.match(future?.detail ?? "", /this harness version/);
});

test("advertises governed Build only for Cursor releases with the verified ACP contract", async () => {
  const inventory = (version: string) => ({
    id: "cursor",
    name: "Cursor Agent",
    readiness: { runtimeId: "cursor", availability: "installed" as const, verification: "ready" as const, version, detail: "Ready." },
    authentication: "authenticated" as const,
    authenticationDetail: "Authenticated.",
    models: [],
    modelDiscovery: "automatic" as const,
    update: { status: "current" as const },
    maintenanceActions: [],
    checkedAt: "2026-08-31T12:00:00.000Z",
  });
  const [verified] = await discoverRuntimes({ discovery: { async list() { return [inventory("Cursor Agent 2026.08.25")]; } } });
  const [older] = await discoverRuntimes({ discovery: { async list() { return [inventory("Cursor Agent 2026.07.31")]; } } });
  assert.ok(verified?.capabilities?.includes("workspace-write"));
  assert.ok(verified?.capabilities?.includes("mcp-tools"));
  assert.equal(older?.capabilities?.includes("workspace-write"), false);
  assert.match(older?.detail ?? "", /this harness version/);
});
