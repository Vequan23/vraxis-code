import { readdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import type { WorkspaceFile } from "@vraxis/code-contracts";

const ignored = new Set([".DS_Store", ".git", ".idea", "node_modules", "dist", "coverage", ".vraxis-code"]);

export async function indexProjectFiles(root: string, limit = 400): Promise<WorkspaceFile[]> {
  const files: WorkspaceFile[] = [];

  async function visit(directory: string): Promise<void> {
    if (files.length >= limit) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (ignored.has(entry.name)) continue;
      const fullPath = `${directory}${sep}${entry.name}`;
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile()) files.push({ path: relative(root, fullPath).split(sep).join("/") });
    }
  }

  await visit(root);
  return files;
}
