import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CredentialResolver, CredentialStore } from "@vraxis/agent-v";
import {
  connectMcpServer,
  type ConnectMcpServerOptions,
  type McpConnectionAuthorizer,
  type McpServerConnection,
  type McpServerDefinition,
  type McpServerInventory,
} from "@vraxis/agent-v/mcp";
import type {
  ConnectMcpServerRequest,
  McpCapabilitySummary,
  McpCredentialKind,
  McpServerSummary,
} from "@vraxis/code-contracts";

export type McpConnector = (
  definition: McpServerDefinition,
  options: ConnectMcpServerOptions,
) => Promise<Pick<McpServerConnection, "inventory" | "tools" | "close">>;

export type McpTaskConnection = Pick<McpServerConnection, "inventory" | "tools" | "close">;

interface StoredMcpServer {
  id: string;
  name: string;
  transport: ConnectMcpServerRequest["transport"];
  command?: string;
  args?: string[];
  url?: string;
  workingProjectId: string;
  projectIds: string[];
  credentialKind: McpCredentialKind;
  credentialName?: string;
  credentialRef?: string;
  inventory: McpServerInventory;
  status: "connected" | "needs-attention";
  connectedAt?: string;
  error?: string;
}

interface McpServerData {
  schemaVersion: 1;
  servers: StoredMcpServer[];
}

export type McpProjectPathResolver = (projectId: string) => Promise<string>;
export interface McpConnectionApprovalContext {
  name: string;
  projectId: string;
  transport: ConnectMcpServerRequest["transport"];
  target: string;
  credentialConfigured: boolean;
}

function capability(item: { name: string; title?: string; description?: string }): McpCapabilitySummary {
  return {
    name: item.name,
    ...(item.title ? { title: item.title } : {}),
    ...(item.description ? { description: item.description.slice(0, 500) } : {}),
  };
}

function safeTarget(server: StoredMcpServer): string {
  if (server.transport === "stdio") {
    const argumentCount = server.args?.length ?? 0;
    return `${server.command} · ${argumentCount} ${argumentCount === 1 ? "argument" : "arguments"}`;
  }
  const url = new URL(server.url!);
  return `${url.origin}${url.pathname}`;
}

function summary(server: StoredMcpServer): McpServerSummary {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    target: safeTarget(server),
    projectIds: [...server.projectIds],
    credentialConfigured: Boolean(server.credentialRef),
    credentialKind: server.credentialKind,
    status: server.status,
    ...(server.inventory.serverName ? { serverName: server.inventory.serverName } : {}),
    ...(server.inventory.serverVersion ? { serverVersion: server.inventory.serverVersion } : {}),
    ...(server.inventory.protocolVersion ? { protocolVersion: server.inventory.protocolVersion } : {}),
    ...(server.inventory.protocolEra ? { protocolEra: server.inventory.protocolEra } : {}),
    tools: server.inventory.tools.map(capability),
    resources: server.inventory.resources.map(capability),
    prompts: server.inventory.prompts.map(capability),
    warnings: server.inventory.warnings.map((warning) => warning.slice(0, 500)),
    ...(server.connectedAt ? { connectedAt: server.connectedAt } : {}),
    ...(server.error ? { error: server.error } : {}),
  };
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : "The MCP server did not accept the connection.";
  return (message || "The MCP server did not accept the connection.").slice(0, 500);
}

export class McpServerRegistry {
  readonly file: string;

  constructor(
    dataDirectory: string,
    private readonly credentials: CredentialStore,
    private readonly connector: McpConnector = connectMcpServer,
  ) {
    this.file = join(dataDirectory, "mcp-servers.json");
  }

  async summaries(): Promise<McpServerSummary[]> {
    return (await this.read()).map(summary);
  }

  async approvalContext(id: string): Promise<McpConnectionApprovalContext> {
    const server = (await this.read()).find((item) => item.id === id);
    if (!server) throw new TypeError("MCP server connection was not found.");
    return {
      name: server.name,
      projectId: server.workingProjectId,
      transport: server.transport,
      target: safeTarget(server),
      credentialConfigured: Boolean(server.credentialRef),
    };
  }

  async connectProject(
    projectId: string,
    workspacePath: string,
    authorizer: McpConnectionAuthorizer,
    abortSignal?: AbortSignal,
  ): Promise<McpTaskConnection[]> {
    const enabled = (await this.read()).filter((server) => server.projectIds.includes(projectId));
    const connections: McpTaskConnection[] = [];
    try {
      for (const server of enabled) {
        connections.push(await this.connector(this.definition(server, workspacePath), {
          authorizer,
          credentials: this.credentials,
          protocolVersion: "auto",
          ...(abortSignal ? { abortSignal } : {}),
        }));
      }
      return connections;
    } catch (error) {
      await Promise.allSettled(connections.map((connection) => connection.close()));
      throw error;
    }
  }

  async connect(
    input: ConnectMcpServerRequest,
    resolveProjectPath: McpProjectPathResolver,
    authorizer: McpConnectionAuthorizer,
  ): Promise<McpServerSummary> {
    const projectPaths = await Promise.all(input.projectIds.map(resolveProjectPath));
    const id = `mcp-${crypto.randomUUID()}`;
    const credentialRef = input.credential ? `keychain://vraxis-code/mcp/${id}` : undefined;
    const temporaryCredentials: CredentialResolver = {
      async resolve(reference) {
        return reference === credentialRef ? input.credential?.value : undefined;
      },
    };
    const draft: StoredMcpServer = {
      id,
      name: input.name,
      transport: input.transport,
      ...(input.transport === "stdio" ? { command: input.command, ...(input.args ? { args: input.args } : {}) } : { url: input.url }),
      workingProjectId: input.projectIds[0]!,
      projectIds: [...input.projectIds],
      credentialKind: input.credential?.kind ?? "none",
      ...(input.credential?.name ? { credentialName: input.credential.name } : {}),
      ...(credentialRef ? { credentialRef } : {}),
      inventory: {
        serverId: id,
        configuredName: input.name,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: [],
        warnings: [],
      },
      status: "connected",
    };
    const connection = await this.connector(this.definition(draft, projectPaths[0]!), {
      authorizer,
      credentials: temporaryCredentials,
      protocolVersion: "auto",
    });
    try {
      draft.inventory = connection.inventory;
      draft.connectedAt = new Date().toISOString();
    } finally {
      await connection.close();
    }
    if (credentialRef && input.credential) await this.credentials.set(credentialRef, input.credential.value);
    try {
      await this.write([...(await this.read()), draft]);
    } catch (error) {
      if (credentialRef) await this.credentials.delete(credentialRef).catch(() => false);
      throw error;
    }
    return summary(draft);
  }

  async refresh(
    id: string,
    resolveProjectPath: McpProjectPathResolver,
    authorizer: McpConnectionAuthorizer,
  ): Promise<McpServerSummary> {
    const servers = await this.read();
    const server = servers.find((item) => item.id === id);
    if (!server) throw new TypeError("MCP server connection was not found.");
    try {
      const projectPath = await resolveProjectPath(server.workingProjectId);
      const connection = await this.connector(this.definition(server, projectPath), {
        authorizer,
        credentials: this.credentials,
        protocolVersion: "auto",
      });
      try { server.inventory = connection.inventory; }
      finally { await connection.close(); }
      server.status = "connected";
      server.connectedAt = new Date().toISOString();
      delete server.error;
      await this.write(servers);
      return summary(server);
    } catch (error) {
      server.status = "needs-attention";
      server.error = failureMessage(error);
      await this.write(servers);
      throw new TypeError(`Could not connect to ${server.name}. ${server.error}`);
    }
  }

  async updateProjects(id: string, projectIds: string[], resolveProjectPath: McpProjectPathResolver): Promise<McpServerSummary> {
    await Promise.all(projectIds.map(resolveProjectPath));
    const servers = await this.read();
    const server = servers.find((item) => item.id === id);
    if (!server) throw new TypeError("MCP server connection was not found.");
    server.projectIds = [...projectIds];
    await this.write(servers);
    return summary(server);
  }

  async remove(id: string): Promise<void> {
    const servers = await this.read();
    const server = servers.find((item) => item.id === id);
    if (!server) throw new TypeError("MCP server connection was not found.");
    await this.write(servers.filter((item) => item.id !== id));
    if (server.credentialRef) await this.credentials.delete(server.credentialRef);
  }

  private definition(server: StoredMcpServer, projectPath: string): McpServerDefinition {
    if (server.transport === "stdio") {
      return {
        id: server.id,
        name: server.name,
        transport: {
          type: "stdio",
          command: server.command!,
          ...(server.args?.length ? { args: server.args } : {}),
          cwd: projectPath,
          ...(server.credentialRef && server.credentialName
            ? { credentialEnvironment: { [server.credentialName]: server.credentialRef } }
            : {}),
        },
      };
    }
    return {
      id: server.id,
      name: server.name,
      transport: {
        type: "streamable-http",
        url: server.url!,
        ...(server.credentialRef && server.credentialKind === "bearer"
          ? { bearerCredentialRef: server.credentialRef }
          : {}),
        ...(server.credentialRef && server.credentialKind === "header" && server.credentialName
          ? { headerCredentialRefs: { [server.credentialName]: server.credentialRef } }
          : {}),
      },
    };
  }

  private async read(): Promise<StoredMcpServer[]> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as McpServerData;
      if (data.schemaVersion !== 1 || !Array.isArray(data.servers)) throw new Error("Unsupported MCP server registry.");
      return data.servers;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(servers: StoredMcpServer[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, servers }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
