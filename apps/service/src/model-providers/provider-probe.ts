import {
  localExecutionScope,
  safeFailure,
  type CredentialStore,
  type RuntimeReadiness,
} from "@vraxis/agent-v";
import { ProviderRuntime, defineProviderProfile } from "@vraxis/agent-v/providers";

const probeOutput = {
  name: "runtime-readiness",
  jsonSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ready"] },
      evidenceLabel: { type: "string", enum: ["runtime-probe"] },
    },
    required: ["status", "evidenceLabel"],
    additionalProperties: false,
  },
  parse(value: unknown) {
    const record = value as { status?: string; evidenceLabel?: string };
    if (record?.status !== "ready" || record.evidenceLabel !== "runtime-probe") {
      throw new Error("Probe output did not match the contract.");
    }
    return { status: "ready" as const, evidenceLabel: "runtime-probe" as const };
  },
};

function resolveProbeModel(
  profile: ReturnType<typeof defineProviderProfile>,
  runtimeModel?: string,
  catalogModelIds?: readonly string[],
): string {
  const preferred = runtimeModel?.trim() || profile.model?.trim();
  if (preferred && preferred !== "__discover__") return preferred;
  const fallback = catalogModelIds?.[0]?.trim();
  if (!fallback) throw new TypeError("Choose a model before testing this provider connection.");
  return fallback;
}

export async function probeProviderConnection(
  stored: {
    id: string;
    name: string;
    provider: Parameters<typeof defineProviderProfile>[0]["provider"];
    model: string;
    credentialRef?: string;
    baseURL?: string;
  },
  credentials: CredentialStore,
  fetcher: typeof globalThis.fetch,
  runtimeModel?: string,
): Promise<{ readiness: RuntimeReadiness; catalogOk: boolean }> {
  const profile = defineProviderProfile({
    id: stored.id,
    name: stored.name,
    provider: stored.provider,
    model: stored.model,
    ...(stored.credentialRef ? { credentialRef: stored.credentialRef } : {}),
    ...(stored.baseURL ? { baseURL: stored.baseURL } : {}),
    kind: "structured-model",
  });
  const runtime = new ProviderRuntime({ credentials, fetch: fetcher });
  const started = Date.now();
  let catalogOk = false;
  let catalogModelIds: string[] = [];
  try {
    const catalog = await runtime.listModels(profile);
    catalogOk = catalog.models.length > 0;
    catalogModelIds = catalog.models.map((item) => item.id);
  } catch (error) {
    const failure = safeFailure(error);
    return {
      catalogOk: false,
      readiness: {
        runtimeId: stored.id,
        availability: "installed",
        verification: "failed",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        detail: failure.message,
        failure: { code: failure.code, message: failure.message, retryable: failure.retryable },
      },
    };
  }

  const model = resolveProbeModel(profile, runtimeModel, catalogModelIds);
  try {
    await runtime.structured.generate({
      runId: crypto.randomUUID(),
      scope: localExecutionScope("runtime-readiness"),
      ...(profile.credentialRef ? { credentialRef: profile.credentialRef } : {}),
      ...(profile.options ? { engineOptions: profile.options } : {}),
      model,
      input: {
        prompt: "Return exactly the requested readiness object.",
        artifacts: [{
          id: "runtime-probe",
          uri: "agent-v://runtime-probe",
          mediaType: "application/json",
          content: "Runtime readiness evidence label: runtime-probe",
        }],
      },
      output: probeOutput,
    });
    return {
      catalogOk,
      readiness: {
        runtimeId: stored.id,
        availability: "installed",
        verification: "ready",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        detail: `${stored.name} credentials, model catalog, and bounded structured output are ready.`,
      },
    };
  } catch (error) {
    const failure = safeFailure(error);
    return {
      catalogOk,
      readiness: {
        runtimeId: stored.id,
        availability: "installed",
        verification: "failed",
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        detail: failure.message,
        failure: { code: failure.code, message: failure.message, retryable: failure.retryable },
      },
    };
  }
}
