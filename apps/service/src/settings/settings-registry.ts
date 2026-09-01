import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  appThemes,
  authorityModes,
  defaultUserSettings,
  sessionModes,
  type AuthorityMode,
  type UpdateSettingsRequest,
  type UserSettings,
} from "@vraxis/code-contracts";

interface SettingsData extends UserSettings {
  schemaVersion: 1;
}

function savedRuntimeModels(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] =>
    Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]));
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function savedRuntimeIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))];
  return ids.length ? ids : undefined;
}

export class SettingsRegistry {
  readonly file: string;

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "settings.json");
  }

  async read(): Promise<UserSettings> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<SettingsData>;
      if (parsed.schemaVersion !== 1) throw new Error("Unsupported settings registry.");
      if (!appThemes.includes(parsed.theme as UserSettings["theme"])) throw new Error("Unsupported saved theme.");
      if (!sessionModes.includes(parsed.defaultMode as UserSettings["defaultMode"])) {
        throw new Error("Unsupported saved task mode.");
      }
      const authorityMode = authorityModes.includes(parsed.authorityMode as AuthorityMode)
        ? parsed.authorityMode as AuthorityMode
        : defaultUserSettings.authorityMode ?? "supervised";
      const runtimeModels = savedRuntimeModels(parsed.runtimeModels);
      const disabledRuntimeIds = savedRuntimeIds(parsed.disabledRuntimeIds);
      return {
        theme: parsed.theme as UserSettings["theme"],
        defaultMode: parsed.defaultMode as UserSettings["defaultMode"],
        authorityMode,
        ...(typeof parsed.defaultRuntimeId === "string" && parsed.defaultRuntimeId
          ? { defaultRuntimeId: parsed.defaultRuntimeId }
          : {}),
        ...(runtimeModels ? { runtimeModels } : {}),
        ...(disabledRuntimeIds ? { disabledRuntimeIds } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(defaultUserSettings);
      throw error;
    }
  }

  async update(input: UpdateSettingsRequest): Promise<UserSettings> {
    const current = await this.read();
    const defaultRuntimeId = input.defaultRuntimeId === undefined
      ? current.defaultRuntimeId
      : input.defaultRuntimeId;
    const runtimeModels = { ...(current.runtimeModels ?? {}) };
    for (const [runtimeId, modelId] of Object.entries(input.runtimeModels ?? {})) {
      if (modelId) runtimeModels[runtimeId] = modelId;
      else delete runtimeModels[runtimeId];
    }
    const settings: UserSettings = {
      theme: input.theme ?? current.theme,
      defaultMode: input.defaultMode ?? current.defaultMode,
      authorityMode: input.authorityMode ?? current.authorityMode ?? defaultUserSettings.authorityMode ?? "supervised",
      ...(defaultRuntimeId ? { defaultRuntimeId } : {}),
      ...(Object.keys(runtimeModels).length ? { runtimeModels } : {}),
      ...((input.disabledRuntimeIds ?? current.disabledRuntimeIds)?.length
        ? { disabledRuntimeIds: [...new Set(input.disabledRuntimeIds ?? current.disabledRuntimeIds)] }
        : {}),
    };
    await this.write(settings);
    return settings;
  }

  private async write(settings: UserSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const data: SettingsData = { schemaVersion: 1, ...settings };
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
