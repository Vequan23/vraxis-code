import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryCredentialStore } from "@vraxis/agent-v";
import type { McpServerDefinition } from "@vraxis/agent-v/mcp";
import { McpServerRegistry, type McpConnector } from "../src/mcp/mcp-server-registry.js";

function connector(definitions: McpServerDefinition[]): McpConnector {
  return async (definition, options) => {
    definitions.push(definition);
    const decision = await options.authorizer.decide({
      serverId: definition.id,
      serverName: definition.name,
      action: definition.transport.type === "stdio" ? "launch-local-process" : "connect-remote-server",
      transport: definition.transport.type,
      target: definition.transport.type === "stdio" ? definition.transport.command : definition.transport.url,
      ...(definition.transport.type === "stdio" ? { workingDirectory: definition.transport.cwd } : {}),
      credentialReferences: [],
    });
    if (decision !== "approved") throw new Error("Connection denied.");
    return {
      inventory: {
        serverId: definition.id,
        configuredName: definition.name,
        serverName: "Fixture MCP",
        serverVersion: "1.0.0",
        protocolEra: "modern",
        protocolVersion: "2026-06-18",
        tools: [{ name: "search", agentToolName: `mcp__${definition.id}__search`, description: "Search fixture data." }],
        resources: [{ uri: "fixture://docs", name: "docs", description: "Fixture documentation." }],
        resourceTemplates: [],
        prompts: [{ name: "review", description: "Review a change." }],
        warnings: [],
      },
      tools: [],
      async close() {},
    };
  };
}

test("connects only through the supplied approval gate and never persists credential values", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-mcp-registry-"));
  const credentials = new MemoryCredentialStore();
  const definitions: McpServerDefinition[] = [];
  const registry = new McpServerRegistry(root, credentials, connector(definitions));
  const connected = await registry.connect({
    name: "Fixture",
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
    projectIds: ["project-1"],
    credential: { kind: "environment", name: "FIXTURE_TOKEN", value: "do-not-persist" },
  }, async () => "/tmp/project", { async decide() { return "approved"; } });

  assert.equal(connected.status, "connected");
  assert.equal(connected.tools[0]?.name, "search");
  assert.equal(connected.credentialConfigured, true);
  assert.equal(definitions[0]?.transport.type, "stdio");
  const stored = await readFile(registry.file, "utf8");
  assert.doesNotMatch(stored, /do-not-persist/);
  assert.match(stored, /keychain:\/\/vraxis-code\/mcp\//);
});

test("a denied product approval prevents the MCP connection from being saved", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-mcp-denied-"));
  const registry = new McpServerRegistry(root, new MemoryCredentialStore(), connector([]));
  await assert.rejects(
    registry.connect({
      name: "Denied",
      transport: "streamable-http",
      url: "https://mcp.example.com/connect",
      projectIds: ["project-1"],
    }, async () => "/tmp/project", { async decide() { return "denied"; } }),
    /denied/i,
  );
  assert.deepEqual(await registry.summaries(), []);
});

test("project access can be revoked without deleting the saved connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-mcp-projects-"));
  const registry = new McpServerRegistry(root, new MemoryCredentialStore(), connector([]));
  const connected = await registry.connect({
    name: "Remote",
    transport: "streamable-http",
    url: "https://mcp.example.com/connect?region=us",
    projectIds: ["project-1"],
  }, async () => "/tmp/project", { async decide() { return "approved"; } });
  const disabled = await registry.updateProjects(connected.id, [], async () => "/tmp/project");
  assert.deepEqual(disabled.projectIds, []);
  assert.equal(disabled.target, "https://mcp.example.com/connect");
  assert.equal((await registry.summaries()).length, 1);
});

test("retains and opens multiple MCP connections for the same project", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-mcp-multiple-"));
  const definitions: McpServerDefinition[] = [];
  const registry = new McpServerRegistry(root, new MemoryCredentialStore(), connector(definitions));
  const authorize = { async decide() { return "approved" as const; } };

  await registry.connect({
    name: "Local tools",
    transport: "stdio",
    command: "node",
    args: ["local-server.mjs"],
    projectIds: ["project-1"],
  }, async () => "/tmp/project", authorize);
  await registry.connect({
    name: "Remote context",
    transport: "streamable-http",
    url: "https://mcp.example.com/connect",
    projectIds: ["project-1"],
  }, async () => "/tmp/project", authorize);

  const summaries = await registry.summaries();
  assert.deepEqual(summaries.map((server) => server.name), ["Local tools", "Remote context"]);
  const connections = await registry.connectProject("project-1", "/tmp/project", authorize);
  assert.equal(connections.length, 2);
  await Promise.all(connections.map((connection) => connection.close()));
});

test("opens only project-enabled task connections and closes partial startup on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "vraxis-mcp-task-"));
  const definitions: McpServerDefinition[] = [];
  const registry = new McpServerRegistry(root, new MemoryCredentialStore(), connector(definitions));
  await registry.connect({
    name: "Task tools",
    transport: "streamable-http",
    url: "https://mcp.example.com/connect",
    projectIds: ["project-1"],
  }, async () => "/tmp/project", { async decide() { return "approved"; } });
  const connections = await registry.connectProject(
    "project-1",
    "/tmp/isolated-worktree",
    { async decide() { return "approved"; } },
  );
  assert.equal(connections.length, 1);
  assert.equal(definitions.length, 2);
  assert.deepEqual(await registry.connectProject(
    "project-2",
    "/tmp/other-project",
    { async decide() { return "approved"; } },
  ), []);
  await connections[0]?.close();
});
