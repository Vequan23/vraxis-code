import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CredentialStore } from "@vraxis/agent-v";
import type { RuntimeReadiness } from "@vraxis/agent-v";
import {
  ProviderRuntime,
  builtInModelProviders,
  defineProviderProfile,
  type ModelProviderId,
  type ProviderModelDescriptor,
} from "@vraxis/agent-v/providers";
import type {
  ConnectModelProviderRequest,
  ModelProviderSummary,
  RuntimeModelSummary,
  RuntimeSummary,
} from "@vraxis/code-contracts";
import { probeProviderConnection } from "./provider-probe.js";

interface StoredProviderProfile {
  id: string;
  name: string;
  provider: ModelProviderId;
  model: string;
  credentialRef?: string;
  baseURL?: string;
  models: ProviderModelDescriptor[];
  fetchedAt?: string;
}

interface ProviderData {
  schemaVersion: 1;
  profiles: StoredProviderProfile[];
}

function runtimeModels(models: ProviderModelDescriptor[]): RuntimeModelSummary[] {
  return models.map((item) => ({
    id: item.id,
    name: item.name,
    availability: "available",
    capabilities: [...item.capabilities],
    ...(item.contextWindow ? { contextWindow: item.contextWindow } : {}),
    ...(item.maxOutputTokens ? { maxOutputTokens: item.maxOutputTokens } : {}),
    ...(item.description ? { description: item.description } : {}),
  }));
}

export class ModelProviderRegistry {
  readonly file: string;

  constructor(
    dataDirectory: string,
    private readonly credentials: CredentialStore,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.file = join(dataDirectory, "model-providers.json");
  }

  async summaries(): Promise<ModelProviderSummary[]> {
    return (await this.read()).map((profile) => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      model: profile.model,
      ...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
      credentialConfigured: Boolean(profile.credentialRef),
      models: runtimeModels(profile.models),
      ...(profile.fetchedAt ? { fetchedAt: profile.fetchedAt } : {}),
    }));
  }

  async runtimes(): Promise<RuntimeSummary[]> {
    return (await this.summaries()).map((profile) => ({
      id: profile.id,
      name: profile.name,
      availability: "installed",
      detail: `${profile.models.length} ${profile.models.length === 1 ? "model" : "models"} available through ${profile.name}.`,
      acceptsCustomModel: true,
      models: profile.models,
      kind: "hosted-provider",
      providerProfileId: profile.id,
      modelDiscovery: profile.fetchedAt ? "automatic" : "manual",
      capabilities: ["structured-output", "local-workspace", "read-only-workspace", "workspace-write", "tools", "artifacts", "browser-control"],
    }));
  }

  async connect(input: ConnectModelProviderRequest): Promise<ModelProviderSummary> {
    const definition = builtInModelProviders.find((item) => item.id === input.provider);
    if (!definition) throw new TypeError("Choose a supported model provider.");
    const id = `provider-${crypto.randomUUID()}`;
    const credentialRef = input.apiKey ? `keychain://vraxis-code/providers/${id}` : undefined;
    const profile = defineProviderProfile({
      id,
      name: input.name?.trim() || definition.name,
      provider: input.provider,
      ...(input.model ? { model: input.model } : input.provider === "openai-compatible" ? { model: "__discover__" } : {}),
      ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      ...(credentialRef ? { credentialRef } : {}),
    });
    const temporaryCredentials: CredentialStore = {
      async resolve(reference) { return reference === credentialRef ? input.apiKey : undefined; },
      async set() { throw new Error("Temporary credentials cannot be changed."); },
      async delete() { return false; },
    };
    const catalog = await new ProviderRuntime({ credentials: temporaryCredentials, fetch: this.fetcher }).listModels(profile);
    const preferredModel = input.model?.trim() || definition.defaultModel;
    const selectedModel = preferredModel && catalog.models.some((item) => item.id === preferredModel)
      ? preferredModel
      : catalog.models[0]!.id;
    const stored: StoredProviderProfile = {
      id,
      name: profile.name,
      provider: input.provider,
      model: selectedModel,
      ...(credentialRef ? { credentialRef } : {}),
      ...(typeof profile.options?.baseURL === "string" ? { baseURL: profile.options.baseURL } : {}),
      models: catalog.models,
      fetchedAt: catalog.fetchedAt,
    };
    if (credentialRef && input.apiKey) await this.credentials.set(credentialRef, input.apiKey);
    try { await this.write([...(await this.read()), stored]); }
    catch (error) {
      if (credentialRef) await this.credentials.delete(credentialRef).catch(() => false);
      throw error;
    }
    return (await this.summaries()).find((item) => item.id === id)!;
  }

  async refresh(id: string): Promise<ModelProviderSummary> {
    const profiles = await this.read();
    const stored = profiles.find((item) => item.id === id);
    if (!stored) throw new TypeError("Model provider connection was not found.");
    const profile = defineProviderProfile(stored);
    const catalog = await new ProviderRuntime({ credentials: this.credentials, fetch: this.fetcher }).listModels(profile);
    stored.models = catalog.models;
    stored.fetchedAt = catalog.fetchedAt;
    await this.write(profiles);
    return (await this.summaries()).find((item) => item.id === id)!;
  }

  async remove(id: string): Promise<void> {
    const profiles = await this.read();
    const stored = profiles.find((item) => item.id === id);
    if (!stored) throw new TypeError("Model provider connection was not found.");
    await this.write(profiles.filter((item) => item.id !== id));
    if (stored.credentialRef) await this.credentials.delete(stored.credentialRef);
  }

  async profile(id: string): Promise<ReturnType<typeof defineProviderProfile> | undefined> {
    const stored = (await this.read()).find((item) => item.id === id);
    return stored ? defineProviderProfile(stored) : undefined;
  }

  async probe(id: string, runtimeModel?: string): Promise<{ readiness: RuntimeReadiness; catalogOk: boolean }> {
    const stored = (await this.read()).find((item) => item.id === id);
    if (!stored) throw new TypeError("Model provider connection was not found.");
    return probeProviderConnection(stored, this.credentials, this.fetcher, runtimeModel);
  }

  private async read(): Promise<StoredProviderProfile[]> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8")) as ProviderData;
      if (data.schemaVersion !== 1 || !Array.isArray(data.profiles)) throw new Error("Unsupported model provider registry.");
      return data.profiles;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(profiles: StoredProviderProfile[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, profiles }, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
