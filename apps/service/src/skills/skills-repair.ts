import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadSkillPackage } from "@vraxis/agent-v/node";
import { parseDocument, stringify } from "yaml";

export function isMetadataRepairableIssue(issue?: string): boolean {
  if (!issue) return false;
  return issue.includes("metadata values must be strings");
}

function coerceMetadataValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function repairMetadataBlock(metadata: Record<string, unknown>): { metadata: Record<string, string>; changed: boolean } {
  let changed = false;
  const repaired: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") repaired[key] = value;
    else {
      repaired[key] = coerceMetadataValue(value);
      changed = true;
    }
  }
  return { metadata: repaired, changed };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function harnessSkillDirectories(base: string): string[] {
  return [
    join(base, ".agents", "skills"),
    join(base, ".codex", "skills"),
    join(base, ".codex", "plugins", "cache"),
    join(base, ".codex", "vendor_imports"),
    join(base, ".claude", "skills"),
    join(base, ".claude", "plugins", "cache"),
    join(base, ".cursor", "skills"),
    join(base, ".cursor", "skills-cursor"),
    join(base, ".cursor", "plugins", "local"),
    join(base, ".config", "opencode", "skills"),
    join(base, ".opencode", "skills"),
  ];
}

async function normalizePath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function addRoot(roots: Set<string>, path: string): Promise<void> {
  roots.add(resolve(path));
  if (await pathExists(path)) roots.add(await normalizePath(path));
}

export async function repairSkillRoots(projectPath: string, homeDirectory = homedir()): Promise<string[]> {
  const roots = new Set<string>();
  await addRoot(roots, homeDirectory);
  for (const repositoryRoot of await projectRepositoryRoots(projectPath)) {
    await addRoot(roots, repositoryRoot);
    for (const directory of harnessSkillDirectories(repositoryRoot)) {
      if (await pathExists(directory)) await addRoot(roots, directory);
    }
  }
  for (const directory of harnessSkillDirectories(homeDirectory)) {
    if (await pathExists(directory)) await addRoot(roots, directory);
  }
  return [...roots];
}

async function projectRepositoryRoots(projectPath: string): Promise<string[]> {
  const roots: string[] = [];
  let current = resolve(projectPath);
  while (true) {
    roots.push(current);
    if (await pathExists(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

async function isInsideAllowedRoot(allowedRoot: string, skillRoot: string): Promise<boolean> {
  const comparisons: Array<[string, string]> = [
    [resolve(allowedRoot), resolve(skillRoot)],
  ];
  if (await pathExists(allowedRoot) && await pathExists(skillRoot)) {
    comparisons.push([await normalizePath(allowedRoot), await normalizePath(skillRoot)]);
  }
  for (const [rootPath, targetPath] of comparisons) {
    const rel = relative(rootPath, targetPath);
    if (!rel.startsWith("..") && !isAbsolute(rel)) return true;
  }
  return false;
}

export async function assertRepairableSkillManifest(
  manifestPath: string,
  projectPath: string,
  homeDirectory = homedir(),
): Promise<string> {
  const logicalManifest = resolve(manifestPath);
  if (basename(logicalManifest) !== "SKILL.md") {
    throw new TypeError("Only SKILL.md manifests can be repaired.");
  }

  const resolvedManifest = await normalizePath(logicalManifest);
  const skillRoots = [...new Set([dirname(logicalManifest), dirname(resolvedManifest)])];
  const allowedRoots = await repairSkillRoots(projectPath, homeDirectory);

  for (const root of allowedRoots) {
    for (const skillRoot of skillRoots) {
      if (await isInsideAllowedRoot(root, skillRoot)) return resolvedManifest;
    }
  }

  throw new TypeError("This skill manifest is outside the approved project and user skill directories.");
}

export async function repairSkillMetadata(manifestPath: string): Promise<{ changed: boolean; summary: string }> {
  const source = await readFile(manifestPath, "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (!match) throw new TypeError("SKILL.md must contain YAML frontmatter followed by Markdown instructions.");

  const document = parseDocument(match[1]!, { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length) {
    throw new TypeError(document.errors.map((error) => error.message).join("; "));
  }

  const frontmatter = document.toJS() as Record<string, unknown> | null;
  if (!frontmatter?.metadata || typeof frontmatter.metadata !== "object" || Array.isArray(frontmatter.metadata)) {
    throw new TypeError("This skill does not have metadata that can be normalized.");
  }

  const { metadata, changed } = repairMetadataBlock(frontmatter.metadata as Record<string, unknown>);
  if (!changed) {
    throw new TypeError("This skill metadata is already compatible.");
  }

  frontmatter.metadata = metadata;
  const repairedFrontmatter = stringify(frontmatter).trimEnd();
  const body = match[2]!.replace(/^\n/u, "");
  const nextSource = `---\n${repairedFrontmatter}\n---\n\n${body}`;
  await writeFile(manifestPath, nextSource, "utf8");

  await loadSkillPackage(dirname(manifestPath));
  return {
    changed: true,
    summary: `Normalized ${Object.keys(metadata).length} metadata field(s) to strings in ${basename(dirname(manifestPath))}/SKILL.md.`,
  };
}

export function describeMetadataRepair(manifestPath: string, skillName: string): string {
  return `${skillName} · ${manifestPath}`;
}
