import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { WorkspaceFileContent } from "@vraxis/code-contracts";

const maximumPreviewBytes = 512 * 1024;
const languages: Record<string, string> = {
  ".bash": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".css": "css",
  ".cs": "csharp",
  ".go": "go",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".ini": "ini",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "jsx",
  ".md": "markdown",
  ".mjs": "javascript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".sh": "shell",
  ".sql": "sql",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".vue": "vue",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export async function readProjectFile(path: string, displayPath: string): Promise<WorkspaceFileContent> {
  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw new TypeError("Choose a file to preview.");
  const truncated = fileStat.size > maximumPreviewBytes;
  const bytes = await readFile(path);
  const preview = bytes.subarray(0, maximumPreviewBytes);
  if (preview.includes(0)) throw new TypeError("This file is binary and cannot be previewed as text.");
  return {
    path: displayPath,
    content: preview.toString("utf8"),
    language: languages[extname(displayPath).toLowerCase()] ?? "text",
    truncated,
  };
}
