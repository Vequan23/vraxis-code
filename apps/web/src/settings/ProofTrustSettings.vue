<script setup lang="ts">
import { onMounted, ref } from "vue";
import type {
  ProofKeyRotationAttestationV1,
  ProofTrustState,
  ProofVerificationSummary,
  TrustedProofSignerSummary,
} from "@vraxis/code-contracts";

defineProps<{
  proofExportReady?: boolean;
  proofExporting?: "" | "html" | "json";
}>();

const emit = defineEmits<{
  "export-proof-json": [];
}>();

const state = ref<ProofTrustState>();
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const notice = ref("");
const label = ref("");
const publicKey = ref("");
const verification = ref<ProofVerificationSummary>();
const proofInput = ref<HTMLInputElement>();
const rotationArmed = ref(false);

function eventValue(event: Event): string {
  return String((event as CustomEvent<[unknown]>).detail?.[0] ?? "");
}

async function request<T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const response = await fetch(path, init);
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The proof trust request failed.");
  return result;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    state.value = await request<ProofTrustState>("/api/proof/trust");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Proof trust could not be loaded.";
  } finally {
    loading.value = false;
  }
}

async function copyIdentity(): Promise<void> {
  if (!state.value) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.value.identity));
    notice.value = "Public proof identity copied. It contains no private key material.";
  } catch {
    notice.value = `Public key: ${state.value.identity.publicKey}`;
  }
}

function downloadRotation(attestation: ProofKeyRotationAttestationV1): void {
  const blob = new Blob([`${JSON.stringify(attestation, null, 2)}\n`], {
    type: "application/vnd.vraxis.proof-key-rotation+json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `vraxis-proof-key-rotation-${attestation.previousIdentity.keyId.slice(0, 12)}-${attestation.nextIdentity.keyId.slice(0, 12)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function rotateIdentity(): Promise<void> {
  if (saving.value) return;
  if (!rotationArmed.value) {
    rotationArmed.value = true;
    notice.value = "Rotation is armed. Copy the current public identity if others rely on it, then confirm rotation.";
    return;
  }
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request<{ state: ProofTrustState; attestation: ProofKeyRotationAttestationV1 }>("/api/proof/rotate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    state.value = result.state;
    rotationArmed.value = false;
    downloadRotation(result.attestation);
    notice.value = "Signing identity rotated. The old identity remains trusted for existing proofs, and a dual-signed attestation was downloaded.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The proof identity could not be rotated.";
  } finally {
    saving.value = false;
  }
}

async function enroll(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await request<{ state: ProofTrustState }>("/api/proof/trust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.value, publicKey: publicKey.value }),
    });
    state.value = result.state;
    label.value = "";
    publicKey.value = "";
    notice.value = "Proof identity enrolled. Future valid proofs from this signer will be marked trusted.";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The proof identity could not be enrolled.";
  } finally {
    saving.value = false;
  }
}

async function revoke(signer: TrustedProofSignerSummary): Promise<void> {
  if (saving.value || signer.revokedAt) return;
  saving.value = true;
  error.value = "";
  try {
    const result = await request<{ state: ProofTrustState }>(`/api/proof/trust/${signer.keyId}`, { method: "DELETE" });
    state.value = result.state;
    notice.value = `${signer.label} is no longer trusted. Existing proof signatures remain mathematically verifiable.`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The proof identity could not be revoked.";
  } finally {
    saving.value = false;
  }
}

async function verifyFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    error.value = "Choose a proof file smaller than 8 MB.";
    return;
  }
  saving.value = true;
  error.value = "";
  verification.value = undefined;
  try {
    verification.value = await request<ProofVerificationSummary>("/api/proof/verify", {
      method: "POST",
      headers: { "content-type": "application/vnd.vraxis.task-proof+json" },
      body: await file.text(),
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The proof file could not be verified.";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="settings-section proof-trust-settings" aria-labelledby="proof-trust-heading">
    <header>
      <span class="section-icon"><osx-icon name="lock" :size="19" /></span>
      <div>
        <h2 id="proof-trust-heading">Proof identity & trust</h2>
        <p>Verify evidence across installations without sharing private signing keys.</p>
      </div>
    </header>
    <osx-alert v-if="error" tone="error" title="Proof trust needs attention" :description="error" />
    <osx-alert v-if="notice" tone="success" title="Proof trust updated" :description="notice" />
    <div v-if="loading" class="proof-trust-loading"><osx-spinner size="small" label="Loading proof trust" show-label /></div>
    <template v-else-if="state">
      <div class="proof-identity-card">
        <span><strong>This installation</strong><small>Ed25519 · {{ state.identity.keyId }}</small></span>
        <div class="proof-identity-actions">
          <osx-button size="small" icon="copy" @click="copyIdentity">Copy public identity</osx-button>
          <osx-button size="small" :variant="rotationArmed ? 'primary' : 'secondary'" :loading="saving" @click="rotateIdentity">
            {{ rotationArmed ? "Confirm rotation" : "Rotate signing key" }}
          </osx-button>
          <osx-button v-if="rotationArmed" size="small" @click="rotationArmed = false">Cancel</osx-button>
        </div>
      </div>
      <div v-if="state.rotations?.length" class="proof-rotation-history">
        <header><strong>Rotation history</strong><small>{{ state.rotations.length }} retained attestation{{ state.rotations.length === 1 ? "" : "s" }}</small></header>
        <ul>
          <li v-for="rotation in state.rotations" :key="rotation.artifactId">
            <span>{{ new Date(rotation.rotatedAt).toLocaleString() }}</span>
            <small>{{ rotation.previousKeyId.slice(0, 12) }} → {{ rotation.nextKeyId.slice(0, 12) }}</small>
          </li>
        </ul>
      </div>
      <div class="proof-trust-grid">
        <section aria-labelledby="trusted-signers-heading">
          <header><strong id="trusted-signers-heading">Trusted signers</strong><small>{{ state.signers.filter((signer) => !signer.revokedAt).length }} active</small></header>
          <ul v-if="state.signers.length" class="trusted-signer-list">
            <li v-for="signer in state.signers" :key="signer.keyId">
              <span><strong>{{ signer.label }}</strong><small>{{ signer.keyId }}</small></span>
              <osx-badge v-if="signer.revokedAt" size="small" tone="neutral" label="Revoked" />
              <osx-button v-else size="small" :disabled="saving" @click="revoke(signer)">Revoke</osx-button>
            </li>
          </ul>
          <div v-else class="proof-trust-empty"><strong>No external signers</strong><small>Enroll a build server or teammate using their public identity.</small></div>
        </section>
        <form aria-label="Enroll proof identity" @submit.prevent="enroll">
          <strong>Enroll an identity</strong>
          <osx-text-field label="Identity label" placeholder="Release build server" :value="label" @input="label = eventValue($event)" />
          <osx-text-field label="SPKI public key" placeholder="Base64 public key" :value="publicKey" @input="publicKey = eventValue($event)" />
          <small>Only the Ed25519 public key is saved. Enrollment grants proof trust, not project or command authority.</small>
          <osx-button type="submit" variant="primary" size="small" :loading="saving" :disabled="!label.trim() || !publicKey.trim()">Enroll signer</osx-button>
        </form>
      </div>
      <section class="proof-export-card" aria-label="Signed JSON export">
        <span>
          <strong>Signed JSON</strong>
          <small v-if="proofExportReady">Machine-readable proof for CI, audit, and verification below.</small>
          <small v-else>Available after the current task passes verification in Verify.</small>
        </span>
        <osx-button
          size="small"
          icon="file-code"
          variant="secondary"
          :loading="proofExporting === 'json'"
          :disabled="!proofExportReady"
          @click="emit('export-proof-json')"
        >
          Export signed JSON
        </osx-button>
      </section>
      <div class="proof-verifier">
        <span><strong>Verify an exported proof</strong><small>Signature validity and signer trust are reported separately.</small></span>
        <input ref="proofInput" class="visually-hidden" type="file" aria-label="Proof file" accept=".json,application/json,application/vnd.vraxis.task-proof+json" @change="verifyFile">
        <osx-button size="small" icon="file" :loading="saving" @click="proofInput?.click()">Choose proof</osx-button>
      </div>
      <osx-alert
        v-if="verification"
        :tone="verification.signature === 'invalid' ? 'error' : verification.trust === 'untrusted' ? 'warning' : 'success'"
        :title="verification.signature === 'invalid' ? 'Invalid proof' : verification.trust === 'untrusted' ? 'Valid, untrusted signer' : 'Valid, trusted proof'"
        :description="verification.detail"
      />
    </template>
  </section>
</template>

<style scoped>
.proof-trust-settings { gap: 15px; }
.proof-trust-loading { min-height: 100px; display: grid; place-items: center; }
.proof-identity-card,
.proof-export-card,
.proof-verifier { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 12px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 8px; background: var(--osx-surface-sunken, #101416); }
.proof-identity-card > span,
.proof-export-card > span,
.proof-verifier > span { min-width: 0; display: grid; gap: 3px; }
.proof-identity-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
.proof-identity-card strong,
.proof-export-card strong,
.proof-verifier strong,
.proof-trust-grid strong { font-size: 12px; font-weight: 650; }
.proof-identity-card small,
.proof-export-card small,
.proof-verifier small,
.proof-trust-grid small { overflow: hidden; color: var(--osx-muted, #98a0a5); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-overflow: ellipsis; white-space: nowrap; }
.proof-trust-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 1fr); gap: 12px; }
.proof-rotation-history { display: grid; gap: 7px; padding: 10px 12px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 8px; }
.proof-rotation-history > header,
.proof-rotation-history li { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.proof-rotation-history ul { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
.proof-rotation-history li { padding-top: 5px; border-top: 1px solid var(--osx-border-soft, #384148); font-size: 12px; }
.proof-rotation-history small { color: var(--osx-muted, #98a0a5); font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.proof-trust-grid > section,
.proof-trust-grid > form { min-width: 0; display: flex; flex-direction: column; gap: 9px; padding: 12px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 8px; background: color-mix(in srgb, var(--osx-surface-sunken, #101416) 70%, transparent); }
.proof-trust-grid > section > header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.trusted-signer-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.trusted-signer-list li { min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid var(--osx-border-soft, #384148); border-radius: 7px; }
.trusted-signer-list li > span { min-width: 0; flex: 1; display: grid; gap: 2px; }
.proof-trust-empty { min-height: 70px; display: grid; place-content: center; gap: 3px; text-align: center; }
.proof-trust-grid > form > osx-button { align-self: flex-end; }
@media (max-width: 760px) {
  .proof-trust-grid { grid-template-columns: 1fr; }
  .proof-identity-card,
  .proof-export-card,
  .proof-verifier { align-items: flex-start; flex-direction: column; }
  .proof-identity-actions { justify-content: flex-start; }
}
</style>
