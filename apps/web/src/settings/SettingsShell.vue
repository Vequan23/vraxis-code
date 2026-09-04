<script setup lang="ts">
import { computed } from "vue";
import type {
  AuthorityMode,
  ModelProviderSummary,
  McpServerSummary,
  ProjectSummary,
  RuntimeMaintenanceActionSummary,
  RuntimeSummary,
  TeamPolicyState,
  UpdateSettingsRequest,
  UserSettings,
  ApprovalRuleSummary,
  TeamPolicyBundleV1,
  TeamPolicyCreateRequest,
  SkillSummary,
} from "@vraxis/code-contracts";
import AgentDefaults from "./AgentDefaults.vue";
import AuthorityModeSettings from "./AuthorityModeSettings.vue";
import GeneralSettings from "./GeneralSettings.vue";
import RuntimeSettings from "./RuntimeSettings.vue";
import HarnessMetricsSettings from "./HarnessMetricsSettings.vue";
import McpConnectionCenter from "./McpConnectionCenter.vue";
import SkillLibrarySettings from "./SkillLibrarySettings.vue";
import PermissionCenter from "./PermissionCenter.vue";
import ProofTrustSettings from "./ProofTrustSettings.vue";
import SupportDiagnostics from "./SupportDiagnostics.vue";
import TeamPolicySettings from "./TeamPolicySettings.vue";
import {
  settingsNavItem,
  settingsNavigation,
  type SettingsSectionId,
} from "./settings-navigation.js";

const props = defineProps<{
  section: SettingsSectionId;
  settings: UserSettings;
  saving: boolean;
  settingsError: string;
  harnessNotice: { tone: "success" | "warning" | "error" | "info"; title: string; description: string } | null;
  themeOptions: Array<{ value: UserSettings["theme"]; label: string; description: string }>;
  runtimes: RuntimeSummary[];
  runtimeRefreshing: boolean;
  runtimeProbingId: string;
  permissionRules: ApprovalRuleSummary[];
  permissionProjects: ProjectSummary[];
  permissionLoading: boolean;
  permissionExporting: boolean;
  permissionActionId: string;
  permissionError: string;
  permissionNotice: string;
  teamPolicy: TeamPolicyState;
  teamPolicyBusy: boolean;
  teamPolicyError: string;
  teamPolicyNotice: string;
  mcpServers: McpServerSummary[];
  skillLibrary: SkillSummary[];
  mcpProjects: ProjectSummary[];
  selectedProjectId?: string;
  modelProviders: ModelProviderSummary[];
  hostedRuntimes: RuntimeSummary[];
  proofExportReady?: boolean;
  proofExporting?: "" | "html" | "json";
}>();

const emit = defineEmits<{
  close: [];
  "update:section": [section: SettingsSectionId];
  update: [patch: UpdateSettingsRequest];
  "theme-change": [theme: UserSettings["theme"]];
  "refresh-permissions": [];
  "export-permissions": [];
  "revoke-permission": [ruleId: string];
  "refresh-team-policy": [];
  "create-team-policy": [request: TeamPolicyCreateRequest];
  "import-team-policy": [bundle: TeamPolicyBundleV1];
  "remove-team-policy": [];
  "team-policy-error": [message: string];
  "refresh-runtimes": [];
  maintain: [runtime: RuntimeSummary, action: RuntimeMaintenanceActionSummary];
  probe: [runtime: RuntimeSummary];
  "mcp-changed": [];
  "skills-changed": [];
  "provider-connected": [providerId: string];
  "providers-changed": [];
  "export-proof-json": [];
}>();

const activeItem = computed(() => {
  if (props.section === "harnesses" || props.section === "models") {
    return settingsNavItem("runtimes");
  }
  return settingsNavItem(props.section);
});

const runtimeFocus = computed(() => {
  if (props.section === "models") return "provider";
  if (props.section === "harnesses") return "harness";
  return undefined;
});

function chooseSection(id: SettingsSectionId): void {
  emit("update:section", id);
}
</script>

<template>
  <div class="settings-shell">
    <header class="settings-header">
      <div>
        <span class="settings-mark"><osx-icon name="settings" :size="22" /></span>
        <span>
          <p class="settings-kicker">Settings</p>
          <h1>{{ activeItem.label }}</h1>
          <p>{{ activeItem.description }}</p>
        </span>
      </div>
      <osx-button size="small" @click="emit('close')">Done</osx-button>
    </header>

    <div class="settings-body">
      <nav class="settings-nav" aria-label="Settings sections">
        <div v-for="group in settingsNavigation" :key="group.label" class="settings-nav-group">
          <p class="settings-nav-group-label">{{ group.label }}</p>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :class="['settings-nav-item', { selected: section === item.id }]"
            :aria-current="section === item.id ? 'page' : undefined"
            @click="chooseSection(item.id)"
          >
            <span class="settings-nav-icon"><osx-icon :name="item.icon" :size="15" /></span>
            <span class="settings-nav-copy">
              <strong>{{ item.label }}</strong>
            </span>
          </button>
        </div>
      </nav>

      <main class="settings-panel" :aria-label="`${activeItem.label} settings`">
        <div class="settings-panel-inner">
          <osx-alert
            v-if="settingsError"
            tone="error"
            title="Settings not saved"
            :description="settingsError"
          />
          <osx-alert
            v-if="harnessNotice"
            class="harness-notice"
            :tone="harnessNotice.tone"
            :title="harnessNotice.title"
            :description="harnessNotice.description"
          />

          <GeneralSettings
            v-if="section === 'general'"
            :theme="settings.theme"
            :saving="saving"
            :theme-options="themeOptions"
            @change="emit('theme-change', $event)"
          />

          <template v-else-if="section === 'agent'">
            <AgentDefaults />
            <AuthorityModeSettings
              :value="settings.authorityMode ?? 'supervised'"
              :saving="saving"
              @change="emit('update', { authorityMode: $event as AuthorityMode })"
            />
          </template>

          <RuntimeSettings
            v-else-if="section === 'runtimes' || section === 'harnesses' || section === 'models'"
            :local-runtimes="runtimes"
            :hosted-runtimes="hostedRuntimes"
            :providers="modelProviders"
            :settings="settings"
            :saving="saving"
            :refreshing="runtimeRefreshing"
            :probing-runtime-id="runtimeProbingId"
            :initial-focus="runtimeFocus"
            @update="emit('update', $event)"
            @refresh="emit('refresh-runtimes')"
            @maintain="(runtime, action) => emit('maintain', runtime, action)"
            @probe="emit('probe', $event)"
            @connected="emit('provider-connected', $event)"
            @changed="emit('providers-changed')"
            @navigate="chooseSection"
          />

          <HarnessMetricsSettings
            v-else-if="section === 'metrics'"
            :settings="settings"
            :saving="saving"
            :runtimes="[...runtimes, ...hostedRuntimes]"
            @update="emit('update', $event)"
            @probe="emit('probe', $event)"
          />

          <McpConnectionCenter
            v-else-if="section === 'integrations'"
            :servers="mcpServers"
            :projects="mcpProjects"
            :selected-project-id="selectedProjectId"
            @changed="emit('mcp-changed')"
          />

          <SkillLibrarySettings
            v-else-if="section === 'skills'"
            :skills="skillLibrary"
            :projects="mcpProjects"
            :selected-project-id="selectedProjectId"
            :runtimes="runtimes.filter((runtime) => runtime.availability === 'installed').map((runtime) => runtime.id)"
            @changed="emit('skills-changed')"
          />

          <PermissionCenter
            v-else-if="section === 'permissions'"
            :rules="permissionRules"
            :projects="permissionProjects"
            :loading="permissionLoading"
            :exporting="permissionExporting"
            :action-id="permissionActionId"
            :error="permissionError"
            :notice="permissionNotice"
            @refresh="emit('refresh-permissions')"
            @export="emit('export-permissions')"
            @revoke="emit('revoke-permission', $event)"
          />

          <ProofTrustSettings
            v-else-if="section === 'proof-trust'"
            :proof-export-ready="proofExportReady"
            :proof-exporting="proofExporting"
            @export-proof-json="emit('export-proof-json')"
          />

          <TeamPolicySettings
            v-else-if="section === 'team-policy'"
            :state="teamPolicy"
            :busy="teamPolicyBusy"
            :error="teamPolicyError"
            :notice="teamPolicyNotice"
            @refresh="emit('refresh-team-policy')"
            @create="emit('create-team-policy', $event)"
            @import="emit('import-team-policy', $event)"
            @remove="emit('remove-team-policy')"
            @error="emit('team-policy-error', $event)"
          />

          <SupportDiagnostics v-else-if="section === 'diagnostics'" />
        </div>
      </main>
    </div>

    <footer class="settings-save-state" aria-live="polite">
      <osx-spinner v-if="saving" size="small" label="Saving settings" show-label />
      <span v-else-if="settingsError"><osx-icon name="warning" :size="14" /> Previous settings restored</span>
      <span v-else><osx-icon name="check" :size="14" /> Saved on this device</span>
    </footer>
  </div>
</template>
