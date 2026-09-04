import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillCreateScope } from "@vraxis/code-contracts";

export const skillNamePattern = /^[a-z][a-z0-9-]{0,47}$/;

export interface CreateSkillInput {
  name: string;
  description: string;
  scope: SkillCreateScope;
  instructions?: string;
}

export function normalizeSkillName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!skillNamePattern.test(normalized)) {
    throw new TypeError("Skill name must start with a letter and use lowercase letters, numbers, and hyphens only.");
  }
  return normalized;
}

export function skillDirectory(
  projectPath: string,
  scope: SkillCreateScope,
  name: string,
  homeDirectory = homedir(),
): string {
  return scope === "user"
    ? join(homeDirectory, ".agents", "skills", name)
    : join(projectPath, ".agents", "skills", name);
}

export function skillManifestPath(projectPath: string, scope: SkillCreateScope, name: string, homeDirectory = homedir()): string {
  return join(skillDirectory(projectPath, scope, name, homeDirectory), "SKILL.md");
}

function titleCaseSkillName(name: string): string {
  return name.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function buildSkillManifest(input: CreateSkillInput): string {
  const name = normalizeSkillName(input.name);
  const description = input.description.trim();
  if (!description) throw new TypeError("Skill description is required.");
  const body = input.instructions?.trim() || [
    `# ${titleCaseSkillName(name)}`,
    "",
    "## Instructions",
    "Add step-by-step guidance for the agent.",
    "",
    "## Examples",
    "Add concrete examples of when and how to use this skill.",
  ].join("\n");
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "metadata:",
    "  version: \"1.0.0\"",
    "---",
    "",
    body,
    "",
  ].join("\n");
}

export function describeSkillCreateScope(manifestPath: string, scope: SkillCreateScope, name: string): string {
  return `${scope} · ${name} · ${manifestPath}`;
}

export async function createSkillScaffold(
  projectPath: string,
  input: CreateSkillInput,
  options?: { homeDirectory?: string },
): Promise<{ manifestPath: string; skillDirectory: string }> {
  const name = normalizeSkillName(input.name);
  const directory = skillDirectory(projectPath, input.scope, name, options?.homeDirectory);
  const manifestPath = join(directory, "SKILL.md");
  try {
    await access(manifestPath);
    throw new TypeError(`A skill named "${name}" already exists at ${manifestPath}.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(directory, { recursive: true });
  await writeFile(manifestPath, buildSkillManifest({ ...input, name }), "utf8");
  return { manifestPath, skillDirectory: directory };
}
