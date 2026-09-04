import { createHash } from "node:crypto";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ProjectSummary } from "@vraxis/code-contracts";
import { normalizeProjectName } from "./project-name.js";

interface RegistryData {
  schemaVersion: 1;
  selectedProjectId?: string;
  projects: ProjectSummary[];
}

const emptyRegistry: RegistryData = { schemaVersion: 1, projects: [] };

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { errorOutput += chunk; });
    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code === 0) resolveOutput(output.trim());
      else reject(new Error(errorOutput.trim() || `git ${args.join(" ")} failed.`));
    });
  });
}

async function gitInit(projectPath: string): Promise<void> {
  try {
    await runGit(projectPath, ["init"]);
  } catch {
    throw new TypeError("Git init failed. Install Git to create a new project.");
  }
}

export class ProjectRegistry {
  readonly file: string;

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "projects.json");
  }

  async read(): Promise<RegistryData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as RegistryData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) throw new Error("Unsupported project registry.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyRegistry);
      throw error;
    }
  }

  async register(projectPath: string): Promise<ProjectSummary> {
    if (!isAbsolute(projectPath)) throw new TypeError("Choose an absolute project path.");
    const canonicalPath = await realpath(projectPath);
    const projectStat = await stat(canonicalPath);
    if (!projectStat.isDirectory()) throw new TypeError("Choose a project folder.");
    await access(canonicalPath, constants.R_OK);

    let branch = "untracked";
    try {
      branch = await runGit(canonicalPath, ["branch", "--show-current"]) || "main";
    } catch {
      branch = "untracked";
    }

    const project: ProjectSummary = {
      id: createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16),
      name: basename(canonicalPath),
      path: canonicalPath,
      branch,
      status: "ready",
    };
    const data = await this.read();
    data.projects = [...data.projects.filter((item) => item.id !== project.id), project];
    data.selectedProjectId = project.id;
    await this.write(data);
    return project;
  }

  async create(parentPath: string, name: string): Promise<ProjectSummary> {
    if (!isAbsolute(parentPath)) throw new TypeError("Choose an absolute parent folder.");
    const normalizedName = normalizeProjectName(name);
    const canonicalParent = await realpath(parentPath);
    const parentStat = await stat(canonicalParent);
    if (!parentStat.isDirectory()) throw new TypeError("Choose a folder to create the project in.");
    await access(canonicalParent, constants.R_OK | constants.W_OK | constants.X_OK);

    const projectPath = resolve(canonicalParent, normalizedName);
    const relativePath = relative(canonicalParent, projectPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new TypeError("The project path is outside the approved parent folder.");
    }

    try {
      await stat(projectPath);
      throw new TypeError("A folder with that name already exists in this location.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(projectPath, { recursive: false, mode: 0o755 });
    await gitInit(projectPath);
    return this.register(projectPath);
  }

  async select(projectId: string): Promise<void> {
    const data = await this.read();
    if (!data.projects.some((project) => project.id === projectId)) throw new TypeError("Project was not found.");
    data.selectedProjectId = projectId;
    await this.write(data);
  }

  async resolveInside(projectId: string, requestedPath = "."): Promise<string> {
    const data = await this.read();
    const project = data.projects.find((item) => item.id === projectId);
    if (!project) throw new TypeError("Project was not found.");
    const candidate = await realpath(resolve(project.path, requestedPath));
    const fromProject = relative(project.path, candidate);
    if (fromProject.startsWith("..") || isAbsolute(fromProject)) {
      throw new TypeError("The requested path is outside the approved project.");
    }
    return candidate;
  }

  private async write(data: RegistryData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
