<script setup lang="ts">
import type { UnderstandArtifactEnvelopeV1, UnderstandEvidenceLinkV1 } from "@vraxis/code-contracts";

defineProps<{ artifact: UnderstandArtifactEnvelopeV1 }>();
const emit = defineEmits<{
  close: [];
  download: [];
  explore: [link: UnderstandEvidenceLinkV1];
}>();

function tone(state: UnderstandArtifactEnvelopeV1["verdict"]["state"]): "success" | "warning" | "danger" | "neutral" {
  if (state === "verified") return "success";
  if (state === "needs-review") return "danger";
  return state === "partially-verified" ? "warning" : "neutral";
}

function evidence(artifact: UnderstandArtifactEnvelopeV1, id: string): UnderstandEvidenceLinkV1 | undefined {
  return artifact.evidenceLinks.find((link) => link.id === id);
}

function exploreById(artifact: UnderstandArtifactEnvelopeV1, id: string | undefined): void {
  if (!id) return;
  const link = evidence(artifact, id);
  if (link) emit("explore", link);
}

function exploreChange(artifact: UnderstandArtifactEnvelopeV1, path: string): void {
  const link = artifact.evidenceLinks.find((item) => item.kind === "change" && item.target === path);
  if (link) emit("explore", link);
}
</script>

<template>
  <section class="understand-artifact" aria-label="Task understanding" aria-live="polite">
    <header class="understand-header">
      <span class="understand-mark"><osx-icon name="sparkle" :size="17" /></span>
      <span class="understand-heading">
        <strong>Understand this task</strong>
        <small>Signed, evidence-grounded, and portable</small>
      </span>
      <osx-badge size="small" :label="artifact.verdict.state.replace('-', ' ')" :tone="tone(artifact.verdict.state)" />
      <osx-button size="small" variant="secondary" icon="download" @click="emit('download')">Signed JSON</osx-button>
      <osx-icon-button label="Close understanding" icon="close" size="small" @click="emit('close')" />
    </header>

    <p class="understand-verdict">{{ artifact.verdict.summary }}</p>

    <div class="understand-grid">
      <section aria-labelledby="understand-changes-title">
        <h3 id="understand-changes-title">Change map</h3>
        <p v-if="!artifact.changes.length" class="understand-empty">No workspace changes were retained.</p>
        <button
          v-for="change in artifact.changes"
          :key="change.path"
          type="button"
          class="understand-row"
          @click="exploreChange(artifact, change.path)"
        >
          <span><osx-icon name="file-code" :size="14" />{{ change.path }}</span>
          <osx-badge size="small" :label="change.coverage" :tone="change.coverage === 'verified' ? 'success' : 'warning'" />
        </button>
      </section>

      <section aria-labelledby="understand-claims-title">
        <h3 id="understand-claims-title">Why the verdict holds</h3>
        <div v-for="claim in artifact.claims" :key="claim.id" class="understand-item">
          <span class="understand-item-icon claim"><osx-icon name="check" :size="13" /></span>
          <span>
            {{ claim.statement }}
            <span v-if="claim.evidenceIds.length" class="understand-links">
              <button v-for="id in claim.evidenceIds" :key="id" type="button" @click="exploreById(artifact, id)">
                {{ evidence(artifact, id)?.label }}
              </button>
            </span>
          </span>
        </div>
      </section>

      <section aria-labelledby="understand-risks-title">
        <h3 id="understand-risks-title">Residual risk</h3>
        <div v-for="risk in artifact.risks" :key="risk.id" class="understand-item">
          <span :class="['understand-item-icon', risk.severity]"><osx-icon :name="risk.severity === 'info' ? 'info' : 'warning'" :size="13" /></span>
          <span><strong>{{ risk.title }}</strong><small>{{ risk.detail }}</small></span>
        </div>
      </section>

      <section aria-labelledby="understand-teach-title">
        <h3 id="understand-teach-title">Teach it back</h3>
        <div v-for="(prompt, index) in artifact.teachBack" :key="prompt.id" class="understand-question">
          <span>{{ index + 1 }}</span>
          <p>{{ prompt.question }}</p>
          <button v-if="prompt.evidenceIds[0] && evidence(artifact, prompt.evidenceIds[0])" type="button" @click="exploreById(artifact, prompt.evidenceIds[0])">Explore evidence</button>
        </div>
      </section>
    </div>

    <footer>
      <span>Artifact {{ artifact.artifactId.slice(7, 19) }}</span>
      <span>Signed by {{ artifact.integrity.keyId.slice(0, 12) }}</span>
      <span v-if="artifact.rollback">Rollback recorded at {{ artifact.rollback.baseCommit.slice(0, 12) }}</span>
    </footer>
  </section>
</template>
