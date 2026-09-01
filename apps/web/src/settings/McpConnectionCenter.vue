<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type {
  ApprovalSummary,
  McpCredentialKind,
  McpServerSummary,
  McpTransportId,
  ProjectSummary,
} from "@vraxis/code-contracts";

const props = defineProps<{
  servers: McpServerSummary[];
  projects: ProjectSummary[];
  selectedProjectId?: string;
}>();

const emit = defineEmits<{ changed: [] }>();

const showingForm = ref(false);
const submitting = ref(false);
const activeActionId = ref("");
const confirmingRemovalId = ref("");
const error = ref("");
const notice = ref("");
const pendingApproval = ref<ApprovalSummary>();
const pendingKind = ref<"connect" | "refresh">("connect");
const form = reactive({
  name: "",
  transport: "stdio" as McpTransportId,
  projectId: props.selectedProjectId ?? props.projects[0]?.id ?? "",
  command: "",
  args: "",
  url: "",
  credentialKind: "none" as McpCredentialKind,
  credentialName: "",
  credentialValue: "",
});

watch(() => props.selectedProjectId, (projectId) => {
  if (projectId && !form.projectId) form.projectId = projectId;
});

const transportOptions = [
  { value: "stdio", label: "Local process", description: "Launch a command inside one approved project." },
  { value: "streamable-http", label: "Remote server", description: "Connect over HTTPS or loopback HTTP." },
];
const projectOptions = computed(() => [
  { value: "", label: "Choose a project" },
  ...props.projects.map((project) => ({ value: project.id, label: project.name })),
]);
const credentialOptions = computed(() => form.transport === "stdio"
  ? [
    { value: "none", label: "No credential" },
    { value: "environment", label: "Secret environment variable" },
  ]
  : [
    { value: "none", label: "No credential" },
    { value: "bearer", label: "Bearer token" },
    { value: "header", label: "Secret header" },
  ]);

function eventValue(event: Event): string {
  return String((event as CustomEvent<[unknown]>).detail?.[0] ?? "");
}

function chooseTransport(event: Event): void {
  const value = eventValue(event);
  if (value !== "stdio" && value !== "streamable-http") return;
  form.transport = value;
  form.credentialKind = "none";
  form.credentialName = "";
  form.credentialValue = "";
  error.value = "";
}

function updateField(field: keyof typeof form, event: Event): void {
  const value = eventValue(event);
  if (field === "credentialKind") form.credentialKind = value as McpCredentialKind;
  else if (field === "transport") form.transport = value as McpTransportId;
  else form[field] = value as never;
  error.value = "";
}

function resetForm(): void {
  form.name = "";
  form.transport = "stdio";
  form.projectId = props.selectedProjectId ?? props.projects[0]?.id ?? "";
  form.command = "";
  form.args = "";
  form.url = "";
  form.credentialKind = "none";
  form.credentialName = "";
  form.credentialValue = "";
  pendingApproval.value = undefined;
  error.value = "";
  showingForm.value = false;
}

async function request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Record<string, unknown>> {
  const response = await fetch(path, init);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The MCP request failed.");
  return result;
}

async function connectServer(): Promise<void> {
  if (!form.name.trim() || !form.projectId) {
    error.value = "Name the connection and choose the project that may use it.";
    return;
  }
  if (form.transport === "stdio" && !form.command.trim()) {
    error.value = "Enter the executable used to start this MCP server.";
    return;
  }
  if (form.transport === "streamable-http" && !form.url.trim()) {
    error.value = "Enter the MCP server URL.";
    return;
  }
  if (form.credentialKind !== "none" && !form.credentialValue.trim()) {
    error.value = "Enter the credential value. It will be stored in the system credential store.";
    return;
  }
  if ((form.credentialKind === "header" || form.credentialKind === "environment") && !form.credentialName.trim()) {
    error.value = "Name the secret header or environment variable.";
    return;
  }
  submitting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request("/api/mcp-servers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        transport: form.transport,
        projectIds: [form.projectId],
        ...(form.transport === "stdio"
          ? {
            command: form.command.trim(),
            args: form.args.split("\n").map((item) => item.trim()).filter(Boolean),
          }
          : { url: form.url.trim() }),
        ...(form.credentialKind !== "none" ? {
          credential: {
            kind: form.credentialKind,
            ...(form.credentialName.trim() ? { name: form.credentialName.trim() } : {}),
            value: form.credentialValue,
          },
        } : {}),
      }),
    });
    form.credentialValue = "";
    pendingApproval.value = result.approval as ApprovalSummary;
    pendingKind.value = "connect";
    notice.value = "Review the exact connection below. Nothing has launched or connected yet.";
  } catch (caught) {
    form.credentialValue = "";
    error.value = caught instanceof Error ? caught.message : "The MCP connection could not be prepared.";
  } finally {
    submitting.value = false;
  }
}

async function prepareRefresh(server: McpServerSummary): Promise<void> {
  activeActionId.value = server.id;
  error.value = "";
  notice.value = "";
  try {
    const result = await request(`/api/mcp-servers/${encodeURIComponent(server.id)}/refresh`, { method: "POST" });
    pendingApproval.value = result.approval as ApprovalSummary;
    pendingKind.value = "refresh";
    notice.value = "Approve the exact reconnection below to refresh this server's capabilities.";
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The MCP refresh could not be prepared.";
  } finally {
    activeActionId.value = "";
  }
}

async function decidePending(decision: "approve" | "deny"): Promise<void> {
  const approval = pendingApproval.value;
  if (!approval) return;
  activeActionId.value = approval.id;
  error.value = "";
  try {
    await request(`/api/approvals/${encodeURIComponent(approval.id)}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    pendingApproval.value = undefined;
    if (decision === "approve") {
      notice.value = pendingKind.value === "connect" ? "MCP server connected and capabilities discovered." : "MCP capabilities refreshed.";
      if (pendingKind.value === "connect") resetForm();
      emit("changed");
    } else notice.value = "Connection denied. No process or network connection was started.";
  } catch (caught) {
    pendingApproval.value = undefined;
    error.value = caught instanceof Error ? caught.message : "The MCP approval could not be completed.";
    emit("changed");
  } finally {
    activeActionId.value = "";
  }
}

async function toggleProject(server: McpServerSummary, event: Event): Promise<void> {
  const enabled = Boolean((event as CustomEvent<[unknown]>).detail?.[0]);
  const projectId = props.selectedProjectId;
  if (!projectId) return;
  const projectIds = enabled
    ? [...new Set([...server.projectIds, projectId])]
    : server.projectIds.filter((id) => id !== projectId);
  activeActionId.value = server.id;
  error.value = "";
  try {
    await request(`/api/mcp-servers/${encodeURIComponent(server.id)}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectIds }),
    });
    notice.value = enabled ? "MCP access enabled for this project." : "MCP access disabled for this project.";
    emit("changed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Project access could not be updated.";
  } finally {
    activeActionId.value = "";
  }
}

async function removeServer(server: McpServerSummary): Promise<void> {
  activeActionId.value = server.id;
  error.value = "";
  try {
    await request(`/api/mcp-servers/${encodeURIComponent(server.id)}`, { method: "DELETE" });
    confirmingRemovalId.value = "";
    notice.value = "MCP connection and its saved credential were removed.";
    emit("changed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The MCP connection could not be removed.";
  } finally {
    activeActionId.value = "";
  }
}
</script>

<template>
  <section class="settings-section mcp-settings" aria-labelledby="mcp-settings-heading">
    <header class="mcp-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="boxes" :size="19" /></span>
        <div>
          <h2 id="mcp-settings-heading">MCP Connection Center</h2>
          <p>Connect external tools and context servers, inspect what they expose, and choose which projects may use them.</p>
        </div>
      </div>
      <osx-button v-if="!showingForm" size="small" icon="plus" :disabled="!projects.length" @click="showingForm = true">Add connection</osx-button>
    </header>

    <osx-alert v-if="error" tone="error" title="MCP connection not updated" :description="error" />
    <osx-alert v-else-if="notice" tone="info" title="MCP Connection Center" :description="notice" />

    <form v-if="showingForm" class="mcp-form" aria-label="Add MCP connection" @submit.prevent="connectServer">
      <div class="provider-form-intro">
        <strong>Add an MCP server</strong>
        <span>Vraxis asks before the first connection, discovers capabilities, and stores secret values only in the system credential store.</span>
      </div>
      <osx-radio-group
        label="Connection type"
        name="mcp-transport"
        variant="cards"
        orientation="horizontal"
        :options="transportOptions"
        :value="form.transport"
        :disabled="submitting || Boolean(pendingApproval)"
        @change="chooseTransport"
      />
      <div class="mcp-form-grid">
        <osx-text-field label="Connection name" name="mcp-name" required placeholder="GitHub tools" :value="form.name" :disabled="submitting || Boolean(pendingApproval)" @input="updateField('name', $event)" />
        <osx-select label="Allowed project" name="mcp-project" required :options="projectOptions" :value="form.projectId" :disabled="submitting || Boolean(pendingApproval)" @change="updateField('projectId', $event)" />
        <template v-if="form.transport === 'stdio'">
          <osx-text-field label="Executable" name="mcp-command" required placeholder="npx" :value="form.command" :disabled="submitting || Boolean(pendingApproval)" hint="Executed directly without a shell inside the selected project." @input="updateField('command', $event)" />
          <osx-textarea label="Arguments" name="mcp-args" rows="4" placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;." :value="form.args" :disabled="submitting || Boolean(pendingApproval)" hint="One argument per line. Never put credentials here." @input="updateField('args', $event)" />
        </template>
        <osx-text-field v-else label="Server URL" name="mcp-url" type="url" required placeholder="https://mcp.example.com/connect" :value="form.url" :disabled="submitting || Boolean(pendingApproval)" hint="Remote servers require HTTPS. Loopback HTTP is allowed for local development." @input="updateField('url', $event)" />
        <osx-select label="Authentication" name="mcp-auth" :options="credentialOptions" :value="form.credentialKind" :disabled="submitting || Boolean(pendingApproval)" @change="updateField('credentialKind', $event)" />
        <osx-text-field
          v-if="form.credentialKind === 'header' || form.credentialKind === 'environment'"
          :label="form.credentialKind === 'header' ? 'Secret header name' : 'Environment variable name'"
          name="mcp-credential-name"
          required
          :placeholder="form.credentialKind === 'header' ? 'X-API-Key' : 'GITHUB_TOKEN'"
          :value="form.credentialName"
          :disabled="submitting || Boolean(pendingApproval)"
          @input="updateField('credentialName', $event)"
        />
        <osx-text-field v-if="form.credentialKind !== 'none'" label="Credential value" name="mcp-credential" type="password" autocomplete="off" required placeholder="Paste credential" :value="form.credentialValue" :disabled="submitting || Boolean(pendingApproval)" hint="Saved to the system credential store after the connection succeeds." @input="updateField('credentialValue', $event)" />
      </div>
      <footer class="provider-form-actions">
        <osx-button size="small" :disabled="submitting || Boolean(pendingApproval)" @click="resetForm">Cancel</osx-button>
        <osx-button variant="primary" size="small" type="submit" :loading="submitting" :disabled="Boolean(pendingApproval)">Review connection</osx-button>
      </footer>
    </form>

    <div v-if="pendingApproval" class="mcp-approval" aria-live="polite">
      <osx-agent-approval
        :title="pendingApproval.title"
        :description="pendingApproval.description"
        :risk="pendingApproval.risk"
        :scope="pendingApproval.scope"
        approve-label="Connect once"
        reject-label="Deny"
        :disabled="activeActionId === pendingApproval.id"
        @approve="decidePending('approve')"
        @reject="decidePending('deny')"
      />
    </div>

    <div v-if="servers.length" class="mcp-list" aria-label="MCP connections">
      <article v-for="server in servers" :key="server.id" class="mcp-card">
        <header>
          <span class="mcp-card-icon"><osx-icon :name="server.transport === 'stdio' ? 'terminal' : 'boxes'" :size="17" /></span>
          <div>
            <strong>{{ server.name }}</strong>
            <small>{{ server.target }}<template v-if="server.serverVersion"> · {{ server.serverVersion }}</template></small>
          </div>
          <osx-badge :tone="server.status === 'connected' ? 'success' : 'warning'" size="small" :label="server.status === 'connected' ? 'Connected' : 'Needs attention'" />
        </header>
        <p v-if="server.error" class="mcp-card-error">{{ server.error }}</p>
        <div class="mcp-capabilities" aria-label="Discovered MCP capabilities">
          <span><strong>{{ server.tools.length }}</strong> tools</span>
          <span><strong>{{ server.resources.length }}</strong> resources</span>
          <span><strong>{{ server.prompts.length }}</strong> prompts</span>
          <span v-if="server.protocolVersion">Protocol {{ server.protocolVersion }}</span>
        </div>
        <details v-if="server.tools.length || server.resources.length || server.prompts.length">
          <summary>View discovered capabilities</summary>
          <div class="mcp-capability-groups">
            <section v-if="server.tools.length"><strong>Tools</strong><ul><li v-for="tool in server.tools" :key="tool.name">{{ tool.title ?? tool.name }}<small v-if="tool.description">{{ tool.description }}</small></li></ul></section>
            <section v-if="server.resources.length"><strong>Resources</strong><ul><li v-for="resource in server.resources" :key="resource.name">{{ resource.title ?? resource.name }}<small v-if="resource.description">{{ resource.description }}</small></li></ul></section>
            <section v-if="server.prompts.length"><strong>Prompts</strong><ul><li v-for="prompt in server.prompts" :key="prompt.name">{{ prompt.title ?? prompt.name }}<small v-if="prompt.description">{{ prompt.description }}</small></li></ul></section>
          </div>
        </details>
        <footer>
          <osx-toggle
            v-if="selectedProjectId"
            label="Available to this project"
            :checked="server.projectIds.includes(selectedProjectId)"
            :disabled="activeActionId === server.id"
            @change="toggleProject(server, $event)"
          />
          <span class="mcp-card-actions">
            <template v-if="confirmingRemovalId === server.id">
              <span>Remove this connection and its saved credential?</span>
              <osx-button size="small" :disabled="activeActionId === server.id" @click="confirmingRemovalId = ''">Cancel</osx-button>
              <osx-button variant="danger" size="small" :loading="activeActionId === server.id" @click="removeServer(server)">Remove</osx-button>
            </template>
            <template v-else>
              <osx-button size="small" icon="refresh" :loading="activeActionId === server.id" @click="prepareRefresh(server)">Refresh</osx-button>
              <osx-button size="small" :disabled="Boolean(activeActionId)" @click="confirmingRemovalId = server.id">Remove</osx-button>
            </template>
          </span>
        </footer>
      </article>
    </div>

    <osx-empty-state
      v-else-if="!showingForm"
      icon="boxes"
      title="No MCP connections"
      description="Connect a local or remote MCP server to inspect its tools, resources, and prompts before exposing it to a project."
      action-label="Add connection"
      @action="showingForm = true"
    />
  </section>
</template>
