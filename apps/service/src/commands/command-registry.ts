import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import type { ComposerCommandScope, ComposerCommandSummary, SessionMode } from "@vraxis/code-contracts";
import { sessionModes } from "@vraxis/code-contracts";

const commandNamePattern = /^[a-z][a-z0-9-]{0,47}$/;

interface ParsedCommandFrontmatter {
  name?: string;
  description?: string;
  mode?: string;
  skills?: string[];
  icon?: string;
  keywords?: string[];
}

function parseFrontmatter(content: string): { frontmatter: ParsedCommandFrontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(content);
  if (!match) return { frontmatter: {}, body: content.trim() };
  const frontmatter: ParsedCommandFrontmatter = {};
  for (const line of match[1]!.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let raw = trimmed.slice(separator + 1).trim();
    if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    if (key === "name") frontmatter.name = raw;
    else if (key === "description") frontmatter.description = raw;
    else if (key === "mode") frontmatter.mode = raw;
    else if (key === "icon") frontmatter.icon = raw;
    else if (key === "skills") {
      frontmatter.skills = raw
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    else if (key === "keywords") {
      frontmatter.keywords = raw
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }
  return { frontmatter, body: match[2]!.trim() };
}

function commandId(scope: ComposerCommandScope, path: string, name: string): string {
  return createHash("sha256").update(`${scope}:${path}:${name}`).digest("hex").slice(0, 20);
}

export async function discoverComposerCommands(
  projectPath: string,
  options?: { userCommandsDirectory?: string },
): Promise<ComposerCommandSummary[]> {
  const roots: Array<{ scope: ComposerCommandScope; directory: string }> = [
    { scope: "project", directory: join(projectPath, ".vraxis", "commands") },
    { scope: "user", directory: options?.userCommandsDirectory ?? join(homedir(), ".vraxis", "commands") },
  ];
  const commands: ComposerCommandSummary[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = (await readdir(root.directory)).filter((entry) => entry.endsWith(".md"));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const absolutePath = join(root.directory, entry);
      let content = "";
      try {
        content = await readFile(absolutePath, "utf8");
      } catch {
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(content);
      const stem = basename(entry, ".md");
      const name = (frontmatter.name ?? stem).trim().toLowerCase();
      if (!commandNamePattern.test(name) || !body.trim()) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const mode = sessionModes.includes(frontmatter.mode as SessionMode)
        ? frontmatter.mode as SessionMode
        : "ask";
      commands.push({
        id: commandId(root.scope, absolutePath, name),
        name,
        description: (frontmatter.description ?? `Run the ${name} recipe.`).trim(),
        mode,
        prompt: body.trim(),
        scope: root.scope,
        path: root.scope === "project" ? relative(projectPath, absolutePath) : absolutePath,
        ...(frontmatter.skills?.length ? { skillNames: frontmatter.skills } : {}),
        ...(frontmatter.icon ? { icon: frontmatter.icon } : {}),
        ...(frontmatter.keywords?.length ? { keywords: frontmatter.keywords } : {}),
      });
    }
  }

  return commands;
}
