<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import type { ApprovalSummary, ProjectSummary, SkillSummary } from "@vraxis/code-contracts";

const props = defineProps<{
  skills: SkillSummary[];
  projects: ProjectSummary[];
  selectedProjectId?: string;
  runtimes: string[];
}>();

const emit = defineEmits<{ changed: [] }>();

const showingForm = ref(false);
const showingCreateForm = ref(false);
const submitting = ref(false);
const creating = ref(false);
const activeActionId = ref("");
const error = ref("");
const notice = ref("");
const pendingApproval = ref<ApprovalSummary>();
const pendingKind = ref<"install" | "repair" | "create">("install");
const repairingSkillId = ref("");
const searchQuery = ref("");
const form = reactive({
  source: "vercel-labs/agent-skills",
  projectId: props.selectedProjectId ?? props.projects[0]?.id ?? "",
  skillNames: "",
  global: false,
});
const createForm = reactive({
  projectId: props.selectedProjectId ?? props.projects[0]?.id ?? "",
  name: "",
  description: "",
  scope: "project" as "project" | "user",
  instructions: "",
});

const curatedSources = [
  { value: "vercel-labs/agent-skills", label: "Vercel agent skills", description: "Official skills from Vercel Labs." },
  { value: "vercel-labs/skills", label: "Vercel skills CLI examples", description: "Sample skills bundled with the CLI repository." },
];
const projectOptions = computed(() => [
  { value: "", label: "Choose a project" },
  ...props.projects.map((project) => ({ value: project.id, label: project.name })),
]);
const readySkills = computed(() => props.skills.filter((skill) => skill.compatibility === "ready"));
const otherSkills = computed(() => props.skills.filter((skill) => skill.compatibility !== "ready"));
const searchNeedle = computed(() => searchQuery.value.trim().toLowerCase());

function skillMatchesSearch(skill: SkillSummary, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    skill.name,
    skill.description,
    skill.issue ?? "",
    skill.sourceLabel ?? "",
    skill.manifestPath ?? "",
    ...skill.scopes,
    ...skill.runtimes,
  ].join(" ").toLowerCase();
  return haystack.includes(needle);
}

const filteredReadySkills = computed(() => readySkills.value.filter((skill) => skillMatchesSearch(skill, searchNeedle.value)));
const filteredOtherSkills = computed(() => otherSkills.value.filter((skill) => skillMatchesSearch(skill, searchNeedle.value)));
const filteredSkillCount = computed(() => filteredReadySkills.value.length + filteredOtherSkills.value.length);
const targetAgents = computed(() => {
  const mapped = props.runtimes.filter((runtime) => ["codex", "claude-code", "cursor", "opencode"].includes(runtime));
  return mapped.length ? mapped.join(", ") : "codex, claude-code, cursor, opencode";
});

function eventValue(event: Event): string {
  return String((event as CustomEvent<[unknown]>).detail?.[0] ?? "");
}

function updateField(field: keyof typeof form, event: Event): void {
  if (field === "global") {
    form.global = Boolean((event as CustomEvent<[unknown]>).detail?.[0]);
  } else {
    const value = eventValue(event);
    form[field] = value as never;
  }
  error.value = "";
}

function resetCreateForm(): void {
  createForm.projectId = props.selectedProjectId ?? props.projects[0]?.id ?? "";
  createForm.name = "";
  createForm.description = "";
  createForm.scope = "project";
  createForm.instructions = "";
  pendingApproval.value = undefined;
  error.value = "";
  showingCreateForm.value = false;
}

function updateCreateField(field: keyof typeof createForm, event: Event): void {
  const value = eventValue(event);
  if (field === "scope") createForm.scope = value === "user" ? "user" : "project";
  else createForm[field] = value as never;
  error.value = "";
}

async function createSkill(): Promise<void> {
  if (!createForm.projectId || !createForm.name.trim() || !createForm.description.trim()) {
    error.value = "Choose a project and enter a skill name and description.";
    return;
  }
  creating.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request(`/api/projects/${encodeURIComponent(createForm.projectId)}/skills/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: createForm.projectId,
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        scope: createForm.scope,
        ...(createForm.instructions.trim() ? { instructions: createForm.instructions.trim() } : {}),
      }),
    });
    pendingApproval.value = result.approval as ApprovalSummary;
    pendingKind.value = "create";
    notice.value = "Review the scaffold path below. Nothing has been written yet.";
    await scrollSettingsPanelToTop();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The skill scaffold could not be prepared.";
  } finally {
    creating.value = false;
  }
}

function resetForm(): void {
  form.source = "vercel-labs/agent-skills";
  form.projectId = props.selectedProjectId ?? props.projects[0]?.id ?? "";
  form.skillNames = "";
  form.global = false;
  pendingApproval.value = undefined;
  error.value = "";
  showingForm.value = false;
}

async function request(path: string, init: NonNullable<Parameters<typeof fetch>[1]>): Promise<Record<string, unknown>> {
  const response = await fetch(path, init);
  const result = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The skills request failed.");
  return result;
}

async function scrollSettingsPanelToTop(): Promise<void> {
  await nextTick();
  document.querySelector<HTMLElement>(".settings-panel")?.scrollTo({ top: 0, behavior: "smooth" });
}

async function installSkills(): Promise<void> {
  if (!form.projectId || !form.source.trim()) {
    error.value = "Choose a project and enter a skills source.";
    return;
  }
  submitting.value = true;
  error.value = "";
  notice.value = "";
  try {
    const skillNames = form.skillNames.split(",").map((item) => item.trim()).filter(Boolean);
    const result = await request(`/api/projects/${encodeURIComponent(form.projectId)}/skills/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: form.projectId,
        source: form.source.trim(),
        ...(form.global ? { global: true } : {}),
        ...(skillNames.length ? { skillNames } : {}),
      }),
    });
    pendingApproval.value = result.approval as ApprovalSummary;
    pendingKind.value = "install";
    notice.value = "Review the exact install command below. Nothing has downloaded yet.";
    await scrollSettingsPanelToTop();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The skills install could not be prepared.";
  } finally {
    submitting.value = false;
  }
}

async function repairSkill(skill: SkillSummary): Promise<void> {
  const projectId = props.selectedProjectId ?? props.projects[0]?.id ?? "";
  if (!projectId || !skill.repairable) {
    error.value = "Choose a project before repairing this skill.";
    return;
  }
  repairingSkillId.value = skill.id;
  error.value = "";
  notice.value = "";
  try {
    const result = await request(`/api/projects/${encodeURIComponent(projectId)}/skills/repair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, skillId: skill.id }),
    });
    pendingApproval.value = result.approval as ApprovalSummary;
    pendingKind.value = "repair";
    notice.value = "Review the metadata repair below. The manifest will not change until you approve.";
    await scrollSettingsPanelToTop();
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "The skill repair could not be prepared.";
  } finally {
    repairingSkillId.value = "";
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
      notice.value = pendingKind.value === "repair"
        ? "Skill metadata repaired. The library has been refreshed."
        : pendingKind.value === "create"
          ? "Skill scaffold created. The library has been refreshed."
          : "Skills installed. The project inventory has been refreshed.";
      if (pendingKind.value === "install") resetForm();
      if (pendingKind.value === "create") resetCreateForm();
      emit("changed");
    } else notice.value = pendingKind.value === "repair"
      ? "Repair denied. The skill manifest was not changed."
      : pendingKind.value === "create"
        ? "Create denied. No skill files were written."
        : "Install denied. No network or command activity ran.";
  } catch (caught) {
    pendingApproval.value = undefined;
    error.value = caught instanceof Error ? caught.message : "The skills approval could not be completed.";
    emit("changed");
  } finally {
    activeActionId.value = "";
  }
}

function updateSearchQuery(event: Event): void {
  searchQuery.value = eventValue(event);
}

function compatibilityLabel(skill: SkillSummary): string {
  if (skill.compatibility === "ready") return "Ready";
  if (skill.compatibility === "unreadable") return "Unreadable";
  return "Incompatible";
}

function compatibilityTone(skill: SkillSummary): "success" | "warning" | "error" {
  if (skill.compatibility === "ready") return "success";
  if (skill.compatibility === "unreadable") return "error";
  return "warning";
}
</script>

<template>
  <section class="settings-section skill-settings" aria-labelledby="skill-settings-heading">
    <header class="skill-settings-header">
      <div class="provider-heading">
        <span class="section-icon"><osx-icon name="sparkle" :size="19" /></span>
        <div>
          <h2 id="skill-settings-heading">Skills library</h2>
          <p>Discover project and user skills, install from skills.sh, or scaffold new ones with <code>/create-skill</code>.</p>
        </div>
      </div>
      <div class="skill-settings-actions">
        <osx-button v-if="!showingCreateForm && !showingForm" size="small" icon="plus" :disabled="!projects.length" @click="showingCreateForm = true; showingForm = false">Create skill</osx-button>
        <osx-button v-if="!showingForm && !showingCreateForm" size="small" variant="secondary" icon="download" :disabled="!projects.length" @click="showingForm = true; showingCreateForm = false">Install skills</osx-button>
      </div>
    </header>

    <osx-alert v-if="error" tone="error" title="Skills library not updated" :description="error" />
    <osx-alert v-else-if="notice" tone="info" title="Skills library" :description="notice" />

    <form v-if="showingCreateForm" class="skill-form" aria-label="Create skill" @submit.prevent="createSkill">
      <div class="provider-form-intro">
        <strong>Create a skill scaffold</strong>
        <span>Writes <code>.agents/skills/&lt;name&gt;/SKILL.md</code> after approval. Use <code>/create-skill</code> in the composer when you want the agent to author the full skill content.</span>
      </div>

      <div class="skill-form-grid">
        <osx-text-field
          label="Skill name"
          name="create-skill-name"
          required
          placeholder="api-review"
          :value="createForm.name"
          :disabled="creating || Boolean(pendingApproval)"
          @input="updateCreateField('name', $event)"
        />
        <osx-text-field
          label="Description"
          name="create-skill-description"
          required
          placeholder="Review API changes for breaking contracts. Use when reviewing HTTP handlers or schema changes."
          :value="createForm.description"
          :disabled="creating || Boolean(pendingApproval)"
          @input="updateCreateField('description', $event)"
        />
        <osx-select
          label="Project"
          name="create-skill-project"
          required
          :options="projectOptions"
          :value="createForm.projectId"
          :disabled="creating || Boolean(pendingApproval)"
          @change="updateCreateField('projectId', $event)"
        />
        <osx-select
          label="Scope"
          name="create-skill-scope"
          :options="[
            { value: 'project', label: 'Project (.agents/skills/)' },
            { value: 'user', label: 'User (~/.agents/skills/)' },
          ]"
          :value="createForm.scope"
          :disabled="creating || Boolean(pendingApproval)"
          @change="updateCreateField('scope', $event)"
        />
        <osx-text-area
          label="Instructions (optional)"
          name="create-skill-instructions"
          placeholder="Optional markdown body. Leave blank for a starter template."
          :value="createForm.instructions"
          :disabled="creating || Boolean(pendingApproval)"
          @input="updateCreateField('instructions', $event)"
        />
      </div>

      <div class="skill-form-actions">
        <osx-button type="button" variant="secondary" :disabled="creating || Boolean(pendingApproval)" @click="resetCreateForm">Cancel</osx-button>
        <osx-button type="submit" :disabled="creating || Boolean(pendingApproval)">Prepare create</osx-button>
      </div>
    </form>

    <form v-if="showingForm" class="skill-form" aria-label="Install skills" @submit.prevent="installSkills">
      <div class="provider-form-intro">
        <strong>Install from skills.sh</strong>
        <span>Vraxis runs <code>npx skills add</code> inside the approved project after you approve network and command access. Skills copy into <code>.agents/skills/</code> for installed harnesses.</span>
      </div>

      <div class="skill-curated-sources">
        <button
          v-for="source in curatedSources"
          :key="source.value"
          type="button"
          :class="['skill-source-card', { selected: form.source === source.value }]"
          :disabled="submitting || Boolean(pendingApproval)"
          @click="form.source = source.value"
        >
          <strong>{{ source.label }}</strong>
          <span>{{ source.description }}</span>
          <code>{{ source.value }}</code>
        </button>
      </div>

      <div class="skill-form-grid">
        <osx-text-field
          label="Source"
          name="skill-source"
          required
          placeholder="vercel-labs/agent-skills"
          :value="form.source"
          :disabled="submitting || Boolean(pendingApproval)"
          @input="updateField('source', $event)"
        />
        <osx-select
          label="Project"
          name="skill-project"
          required
          :options="projectOptions"
          :value="form.projectId"
          :disabled="submitting || Boolean(pendingApproval)"
          @change="updateField('projectId', $event)"
        />
        <osx-text-field
          label="Skill names (optional)"
          name="skill-names"
          placeholder="web-design-guidelines, agent-browser"
          :value="form.skillNames"
          :disabled="submitting || Boolean(pendingApproval)"
          @input="updateField('skillNames', $event)"
        />
        <osx-toggle
          label="Install globally"
          :checked="form.global"
          :disabled="submitting || Boolean(pendingApproval)"
          @change="updateField('global', $event)"
        />
      </div>

      <p class="skill-form-meta">Targets installed harnesses: {{ targetAgents }}.</p>

      <div class="skill-form-actions">
        <osx-button type="button" variant="secondary" :disabled="submitting || Boolean(pendingApproval)" @click="resetForm">Cancel</osx-button>
        <osx-button type="submit" :disabled="submitting || Boolean(pendingApproval)">Prepare install</osx-button>
      </div>
    </form>

    <section v-if="pendingApproval" class="skill-approval-card" :aria-label="pendingKind === 'repair' ? 'Pending skill repair approval' : pendingKind === 'create' ? 'Pending skill create approval' : 'Pending skills install approval'">
      <header>
        <strong>{{ pendingApproval.title }}</strong>
        <span>{{ pendingApproval.description }}</span>
      </header>
      <code>{{ pendingApproval.scope }}</code>
      <div class="skill-form-actions">
        <osx-button variant="secondary" :disabled="activeActionId === pendingApproval.id" @click="decidePending('deny')">Deny</osx-button>
        <osx-button :disabled="activeActionId === pendingApproval.id" @click="decidePending('approve')">
          {{ pendingKind === "repair" ? "Approve repair" : pendingKind === "create" ? "Approve create" : "Approve install" }}
        </osx-button>
      </div>
    </section>

    <div v-if="skills.length" class="skill-search-toolbar">
      <div>
        <strong>Discovered skills</strong>
        <small>{{ filteredSkillCount }} of {{ skills.length }} shown</small>
      </div>
      <osx-text-field
        label="Search skills"
        type="search"
        icon="search"
        placeholder="Name, runtime, source, or description"
        :value="searchQuery"
        @input="updateSearchQuery"
      />
    </div>

    <section v-if="filteredReadySkills.length" class="skill-list-section" aria-label="Ready skills">
      <header><h3>Ready in this project</h3></header>
      <div class="skill-list">
        <article v-for="skill in filteredReadySkills" :key="skill.id" class="skill-card">
          <div class="skill-card-heading">
            <strong>{{ skill.name }}</strong>
            <osx-badge tone="success" label="Ready" />
          </div>
          <p>{{ skill.description }}</p>
          <div class="skill-card-meta">
            <span>{{ skill.sourceLabel ?? "skill" }}</span>
            <span>{{ skill.scopes.join(", ") }}</span>
            <span>{{ skill.runtimes.join(", ") || "all runtimes" }}</span>
          </div>
        </article>
      </div>
    </section>

    <section v-if="filteredOtherSkills.length" class="skill-list-section" aria-label="Other discovered skills">
      <header><h3>Needs attention</h3></header>
      <div class="skill-list">
        <article v-for="skill in filteredOtherSkills" :key="skill.id" class="skill-card">
          <div class="skill-card-heading">
            <strong>{{ skill.name }}</strong>
            <osx-badge :tone="compatibilityTone(skill)" :label="compatibilityLabel(skill)" />
          </div>
          <p>{{ skill.issue || skill.description }}</p>
          <div class="skill-card-meta">
            <span>{{ skill.sourceLabel ?? "skill" }}</span>
            <span v-if="skill.manifestPath">{{ skill.manifestPath }}</span>
          </div>
          <div v-if="skill.repairable" class="skill-card-actions">
            <osx-button
              size="small"
              icon="settings"
              :loading="repairingSkillId === skill.id"
              :disabled="Boolean(pendingApproval) || !selectedProjectId"
              @click="repairSkill(skill)"
            >
              Fix metadata
            </osx-button>
            <small>Converts arrays, numbers, and nested values into strings in SKILL.md.</small>
          </div>
        </article>
      </div>
    </section>

    <div v-if="skills.length && searchNeedle && filteredSkillCount === 0" class="skill-search-empty">
      <osx-icon name="search" :size="18" />
      <span>
        <strong>No matching skills</strong>
        <small>Try another name, runtime, source, or description.</small>
      </span>
    </div>

    <osx-empty-state
      v-if="!skills.length && !showingForm"
      title="No skills discovered yet"
      description="Install skills from skills.sh, run /create-skill in the composer, or add SKILL.md files under .agents/skills/."
      action-label="Create skill"
      @action="showingCreateForm = true; showingForm = false"
    />
  </section>
</template>
