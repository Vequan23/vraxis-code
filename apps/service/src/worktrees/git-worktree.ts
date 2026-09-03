import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  WorktreeSummary,
  WorktreeConflictSummary,
  WorktreeHunkSelection,
  WorkspaceChange,
  WorkspaceChangeStatus,
  WorkspaceDiff,
  WorkspaceEvidenceResponse,
} from "@vraxis/code-contracts";
import { normalizeBranchSlug } from "@vraxis/code-contracts";
import { indexProjectFiles } from "../workspace/file-index.js";
import { readProjectFile } from "../workspace/read-project-file.js";

interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runGit(cwd: string, args: string[], acceptedCodes: readonly number[] = [0]): Promise<GitResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    const maximumBytes = 8 * 1024 * 1024;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= maximumBytes) output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= maximumBytes) errors.push(chunk);
    });
    child.once("error", () => reject(new TypeError("Git is required to create an isolated Build worktree.")));
    child.once("close", (code) => {
      const result = {
        stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8"),
        code: code ?? -1,
      };
      if (bytes > maximumBytes) {
        reject(new TypeError("Git returned too much output while inspecting the worktree."));
      } else if (!acceptedCodes.includes(result.code)) {
        reject(new TypeError(result.stderr.trim() || "Git could not prepare the isolated Build worktree."));
      } else {
        resolveResult(result);
      }
    });
  });
}

function branchSlug(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return slug || "build";
}

function changeStatus(code: string): WorkspaceChangeStatus {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  return "modified";
}

function parseDiffChanges(output: string): WorkspaceChange[] {
  const tokens = output.split("\0").filter(Boolean);
  const changes = new Map<string, WorkspaceChange>();
  for (let index = 0; index < tokens.length;) {
    const code = tokens[index++] ?? "";
    const status = changeStatus(code);
    if (code.startsWith("R") || code.startsWith("C")) {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (path && previousPath) changes.set(path, { path, previousPath, status });
      continue;
    }
    const path = tokens[index++];
    if (path) changes.set(path, { path, status });
  }
  return [...changes.values()];
}

function patchCounts(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function patchPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\n/g, "\\n");
}

interface ParsedPatchHunk {
  id: string;
  header: string;
  patch: string;
  additions: number;
  deletions: number;
}

interface ParsedFilePatch {
  header: string;
  hunks: ParsedPatchHunk[];
  partialSelection: boolean;
}

function parseFilePatch(path: string, patch: string): ParsedFilePatch {
  const matches = [...patch.matchAll(/^@@[^\n]*$/gm)];
  const header = matches[0]?.index === undefined ? patch : patch.slice(0, matches[0].index);
  const hunks = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? patch.length;
    const hunkPatch = patch.slice(start, end);
    const counts = patchCounts(hunkPatch);
    return {
      id: createHash("sha256").update(path).update("\0").update(hunkPatch).digest("hex").slice(0, 24),
      header: match[0],
      patch: hunkPatch.endsWith("\n") ? hunkPatch : `${hunkPatch}\n`,
      additions: counts.additions,
      deletions: counts.deletions,
    };
  });
  const partialSelection = hunks.length > 0
    && !/^(new file mode|deleted file mode|rename from|rename to|copy from|copy to|GIT binary patch|Binary files )/m.test(patch);
  return { header, hunks, partialSelection };
}

function literalPathspec(path: string): string {
  return `:(top,literal)${path}`;
}

export class WorktreeApplyConflictError extends TypeError {
  readonly conflicts: WorktreeConflictSummary[];

  constructor(conflicts: WorktreeConflictSummary[]) {
    super("The project now has overlapping changes. Apply the safe hunks separately, or review the preserved checkpoint before retrying.");
    this.name = "WorktreeApplyConflictError";
    this.conflicts = conflicts;
  }
}

export class GitWorktrees {
  readonly directory: string;

  constructor(dataDirectory: string) {
    this.directory = resolve(dataDirectory, "worktrees");
  }

  async create(projectPath: string, projectId: string, title: string, preferredBranchSlug?: string): Promise<WorktreeSummary> {
    const canonicalProject = await realpath(projectPath);
    const repositoryRoot = await realpath((await runGit(canonicalProject, ["rev-parse", "--show-toplevel"])).stdout.trim());
    if (repositoryRoot !== canonicalProject) {
      throw new TypeError("Build requires the approved project folder to be the Git repository root.");
    }
    const headResult = await runGit(canonicalProject, ["rev-parse", "--verify", "HEAD"], [0, 128]);
    const sourceCommit = headResult.code === 0 ? headResult.stdout.trim() : undefined;
    const baseBranch = (await runGit(canonicalProject, ["branch", "--show-current"])).stdout.trim() || "detached HEAD";
    const id = randomUUID();
    const branch = preferredBranchSlug
      ? `vraxis/${normalizeBranchSlug(preferredBranchSlug)}-${id.slice(0, 8)}`
      : `vraxis/${branchSlug(title)}-${id.slice(0, 8)}`;
    const path = join(this.directory, projectId, id);
    await mkdir(dirname(path), { recursive: true });
    let worktreeCreated = false;
    try {
      await runGit(
        canonicalProject,
        sourceCommit
          ? ["worktree", "add", "-b", branch, path, sourceCommit]
          : ["worktree", "add", "--orphan", "-b", branch, path],
      );
      worktreeCreated = true;
      const canonicalWorktree = await realpath(path);
      await this.snapshotProject(canonicalProject, canonicalWorktree);
      await runGit(canonicalWorktree, ["add", "-A"]);
      const staged = await runGit(canonicalWorktree, ["diff", "--cached", "--quiet"], [0, 1]);
      let baseCommit = sourceCommit;
      if (!sourceCommit || staged.code === 1) {
        const tree = (await runGit(canonicalWorktree, ["write-tree"])).stdout.trim();
        const commitArguments = [
          "-c", "user.name=Vraxis Code",
          "-c", "user.email=vraxis-code@localhost",
          "commit-tree", tree,
          ...(sourceCommit ? ["-p", sourceCommit] : []),
          "-m", "Vraxis Code Build baseline",
        ];
        baseCommit = (await runGit(canonicalWorktree, commitArguments)).stdout.trim();
        await runGit(canonicalWorktree, ["update-ref", `refs/heads/${branch}`, baseCommit]);
      }
      if (!baseCommit) throw new TypeError("Git could not create the isolated Build baseline.");
      return { id, path: canonicalWorktree, branch, baseBranch, baseCommit, status: "active" };
    } catch (error) {
      if (worktreeCreated) {
        await runGit(canonicalProject, ["worktree", "remove", "--force", path], [0, 128]).catch(() => undefined);
        await runGit(canonicalProject, ["branch", "-D", branch], [0, 1, 128]).catch(() => undefined);
      }
      throw error;
    }
  }

  async resolveInside(worktree: WorktreeSummary, requestedPath = ".", requireExisting = true): Promise<string> {
    const directory = await realpath(this.directory);
    const root = await realpath(worktree.path);
    this.assertInside(directory, root, "The Build worktree is outside Vraxis Code storage.");
    const candidate = resolve(root, requestedPath);
    this.assertInside(root, candidate, "The requested path is outside the Build worktree.");
    if (!requireExisting) return candidate;
    const canonical = await realpath(candidate);
    this.assertInside(root, canonical, "The requested path is outside the Build worktree.");
    return canonical;
  }

  async evidence(worktree: WorktreeSummary): Promise<WorkspaceEvidenceResponse> {
    const root = await this.resolveInside(worktree);
    const compared = parseDiffChanges((await runGit(root, [
      "diff", "--name-status", "-z", "--find-renames", worktree.baseCommit, "--",
    ])).stdout);
    const changesByPath = new Map(compared.map((change) => [change.path, change]));
    const untracked = (await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout
      .split("\0")
      .filter(Boolean);
    for (const path of untracked) changesByPath.set(path, { path, status: "untracked" });
    const changes = [...changesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
    const byPath = new Map(changes.map((change) => [change.path, change.status]));
    const indexed = await indexProjectFiles(root);
    const files = indexed.map((file) => {
      const status = byPath.get(file.path);
      return status ? { ...file, status } : file;
    });
    for (const change of changes) {
      if (!files.some((file) => file.path === change.path)) files.push({ path: change.path, status: change.status });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    return { files, changes, worktree };
  }

  async diff(worktree: WorktreeSummary, requestedPath: string): Promise<WorkspaceDiff> {
    const root = await this.resolveInside(worktree);
    const change = (await this.evidence(worktree)).changes.find((item) => item.path === requestedPath);
    if (!change) throw new TypeError("This file has no Build changes to inspect.");
    await this.resolveInside(worktree, requestedPath, change.status === "deleted" ? false : true);
    let patch: string;
    let language = "text";
    let binary = false;
    if (change.status === "untracked") {
      try {
        const file = await readProjectFile(resolve(root, requestedPath), requestedPath);
        language = file.language;
        const lines = file.content.split("\n");
        if (lines.at(-1) === "") lines.pop();
        const path = patchPath(requestedPath);
        patch = [
          `diff --git a/${path} b/${path}`,
          "new file mode 100644",
          "--- /dev/null",
          `+++ b/${path}`,
          ...(lines.length ? [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)] : []),
          "",
        ].join("\n");
      } catch (error) {
        if (!(error instanceof TypeError) || !error.message.includes("binary")) throw error;
        binary = true;
        patch = `Binary file ${patchPath(requestedPath)} was added.\n`;
      }
    } else {
      patch = (await runGit(root, ["diff", "--no-ext-diff", "--unified=3", worktree.baseCommit, "--", requestedPath])).stdout;
      binary = patch.includes("GIT binary patch") || patch.includes("Binary files");
      if (change.status !== "deleted" && !binary) {
        language = (await readProjectFile(resolve(root, requestedPath), requestedPath)).language;
      }
    }
    const counts = patchCounts(patch);
    const parsed = parseFilePatch(requestedPath, patch);
    return {
      path: requestedPath,
      patch,
      language,
      additions: counts.additions,
      deletions: counts.deletions,
      binary,
      partialSelection: !binary && change.status === "modified" && parsed.partialSelection,
      hunks: parsed.hunks.map(({ id, header, additions, deletions }) => ({ id, header, additions, deletions })),
    };
  }

  async checkpoint(worktree: WorktreeSummary, title: string): Promise<string> {
    if (worktree.status !== "active") throw new TypeError("Only an active Build worktree can be checkpointed.");
    const root = await this.resolveInside(worktree);
    const changes = (await this.evidence(worktree)).changes;
    if (!changes.length) throw new TypeError("This Build has no changes to checkpoint.");
    await runGit(root, ["add", "-A"]);
    const tree = (await runGit(root, ["write-tree"])).stdout.trim();
    const parent = (await runGit(root, ["rev-parse", "HEAD"])).stdout.trim();
    const parentTree = (await runGit(root, ["rev-parse", `${parent}^{tree}`])).stdout.trim();
    if (tree === parentTree) return parent;
    const commit = (await runGit(root, [
      "-c", "user.name=Vraxis Code",
      "-c", "user.email=vraxis-code@localhost",
      "commit-tree", tree,
      "-p", parent,
      "-m", `Vraxis Code checkpoint: ${title}`,
    ])).stdout.trim();
    await runGit(root, ["update-ref", `refs/heads/${worktree.branch}`, commit, parent]);
    return commit;
  }

  async applyCheckpoint(
    worktree: WorktreeSummary,
    projectPath: string,
    checkpointCommit: string,
    paths: string[] = [],
    hunks: WorktreeHunkSelection[] = [],
  ): Promise<void> {
    if (worktree.status !== "applying") throw new TypeError("This Build is not ready to apply.");
    const projectRoot = await this.approvedProjectRoot(projectPath);
    await this.withPatchFile(worktree, checkpointCommit, async (patchFile) => {
      const check = await runGit(projectRoot, ["apply", "--check", "--binary", patchFile], [0, 1, 128]);
      if (check.code !== 0) {
        throw new WorktreeApplyConflictError(await this.conflictsForSelection(
          worktree,
          checkpointCommit,
          projectRoot,
          paths,
          hunks,
        ));
      }
      await runGit(projectRoot, ["apply", "--binary", patchFile]);
    }, paths, hunks);
  }

  async revertCheckpoint(worktree: WorktreeSummary, projectPath: string): Promise<void> {
    if (worktree.status !== "applied" || !worktree.checkpointCommit) {
      throw new TypeError("Only an applied Build checkpoint can be reverted.");
    }
    const projectRoot = await this.approvedProjectRoot(projectPath);
    await this.withPatchFile(worktree, worktree.checkpointCommit, async (patchFile) => {
      const check = await runGit(projectRoot, ["apply", "--reverse", "--check", "--binary", patchFile], [0, 1, 128]);
      if (check.code !== 0) {
        throw new TypeError("The project changed after this Build was applied. Resolve the overlapping edits before retrying the revert.");
      }
      await runGit(projectRoot, ["apply", "--reverse", "--binary", patchFile]);
    });
  }

  async cleanup(worktree: WorktreeSummary, projectPath: string): Promise<void> {
    if (worktree.status !== "archived") throw new TypeError("Archive this Build before cleaning up its worktree.");
    const projectRoot = await this.approvedProjectRoot(projectPath);
    const storageRoot = await realpath(this.directory);
    const target = resolve(worktree.path);
    this.assertInside(storageRoot, target, "The Build worktree is outside Vraxis Code storage.");
    await runGit(projectRoot, ["worktree", "remove", "--force", target], [0, 128]);
    await rm(target, { recursive: true, force: true });
    await runGit(projectRoot, ["worktree", "prune"]);
  }

  async restore(worktree: WorktreeSummary, projectPath: string): Promise<string> {
    if (worktree.status !== "archived" && worktree.status !== "cleaned") {
      throw new TypeError("Only an archived or cleaned Build can be restored.");
    }
    const projectRoot = await this.approvedProjectRoot(projectPath);
    const storageRoot = await realpath(this.directory);
    const target = resolve(worktree.path);
    this.assertInside(storageRoot, target, "The Build worktree is outside Vraxis Code storage.");
    try {
      const existing = await realpath(target);
      this.assertInside(storageRoot, existing, "The Build worktree is outside Vraxis Code storage.");
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await runGit(projectRoot, ["show-ref", "--verify", `refs/heads/${worktree.branch}`]);
    await mkdir(dirname(target), { recursive: true });
    await runGit(projectRoot, ["worktree", "prune"]);
    await runGit(projectRoot, ["worktree", "add", target, worktree.branch]);
    return realpath(target);
  }

  async applicationState(
    worktree: WorktreeSummary,
    projectPath: string,
    paths: string[] = [],
    hunks: WorktreeHunkSelection[] = [],
  ): Promise<"applied" | "not-applied" | "conflicted"> {
    if (!worktree.checkpointCommit) return "conflicted";
    const projectRoot = await this.approvedProjectRoot(projectPath);
    return this.withPatchFile(worktree, worktree.checkpointCommit, async (patchFile) => {
      const forward = await runGit(projectRoot, ["apply", "--check", "--binary", patchFile], [0, 1, 128]);
      if (forward.code === 0) return "not-applied";
      const reverse = await runGit(projectRoot, ["apply", "--reverse", "--check", "--binary", patchFile], [0, 1, 128]);
      return reverse.code === 0 ? "applied" : "conflicted";
    }, paths, hunks);
  }

  private async approvedProjectRoot(projectPath: string): Promise<string> {
    const projectRoot = await realpath(projectPath);
    const repositoryRoot = await realpath((await runGit(projectRoot, ["rev-parse", "--show-toplevel"])).stdout.trim());
    if (repositoryRoot !== projectRoot) throw new TypeError("The approved project is no longer the Git repository root.");
    return projectRoot;
  }

  private async withPatchFile<T>(
    worktree: WorktreeSummary,
    checkpointCommit: string,
    operation: (patchFile: string) => Promise<T>,
    paths: string[] = [],
    hunks: WorktreeHunkSelection[] = [],
  ): Promise<T> {
    const patch = await this.selectedPatch(worktree, checkpointCommit, paths, hunks);
    if (!patch.trim()) throw new TypeError("This Build has no changes to apply.");
    return this.withTemporaryPatch(patch, operation);
  }

  private async withTemporaryPatch<T>(patch: string, operation: (patchFile: string) => Promise<T>): Promise<T> {
    const temporary = await mkdtemp(join(tmpdir(), "vraxis-code-apply-"));
    const patchFile = join(temporary, "changes.patch");
    try {
      await writeFile(patchFile, patch, { mode: 0o600 });
      return await operation(patchFile);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  private async checkpointFilePatch(worktree: WorktreeSummary, checkpointCommit: string, path: string): Promise<string> {
    const root = await this.resolveInside(worktree);
    return (await runGit(root, [
      "diff", "--binary", "--full-index", worktree.baseCommit, checkpointCommit, "--", literalPathspec(path),
    ])).stdout;
  }

  private async selectedPatch(
    worktree: WorktreeSummary,
    checkpointCommit: string,
    paths: string[],
    selections: WorktreeHunkSelection[],
  ): Promise<string> {
    if (!paths.length && !selections.length) {
      const root = await this.resolveInside(worktree);
      return (await runGit(root, ["diff", "--binary", "--full-index", worktree.baseCommit, checkpointCommit, "--"])).stdout;
    }
    const fullPaths = new Set(paths);
    const selectedPaths = new Set<string>();
    const patches: string[] = [];
    for (const path of paths) {
      if (!path || selectedPaths.has(path)) throw new TypeError("Each selected Build file must be unique.");
      selectedPaths.add(path);
      const patch = await this.checkpointFilePatch(worktree, checkpointCommit, path);
      if (!patch.trim()) throw new TypeError(`The selected file no longer exists in the checkpoint: ${path}`);
      patches.push(patch);
    }
    for (const selection of selections) {
      if (!selection.path || fullPaths.has(selection.path) || selectedPaths.has(selection.path)) {
        throw new TypeError("A Build file cannot be selected more than once.");
      }
      selectedPaths.add(selection.path);
      if (!selection.hunkIds.length || new Set(selection.hunkIds).size !== selection.hunkIds.length) {
        throw new TypeError("Choose one or more unique checkpoint hunks.");
      }
      const filePatch = await this.checkpointFilePatch(worktree, checkpointCommit, selection.path);
      const parsed = parseFilePatch(selection.path, filePatch);
      if (!parsed.partialSelection) throw new TypeError("This file must be applied as a whole file.");
      const byId = new Map(parsed.hunks.map((hunk) => [hunk.id, hunk]));
      const selected = selection.hunkIds.map((id) => byId.get(id));
      if (selected.some((hunk) => !hunk)) throw new TypeError("The selected hunk is no longer part of the checkpoint.");
      patches.push(`${parsed.header}${selected.map((hunk) => hunk!.patch).join("")}`);
    }
    return patches.join("");
  }

  private async patchApplies(projectRoot: string, patch: string): Promise<boolean> {
    return this.withTemporaryPatch(patch, async (patchFile) => {
      const result = await runGit(projectRoot, ["apply", "--check", "--binary", patchFile], [0, 1, 128]);
      return result.code === 0;
    });
  }

  private async conflictsForSelection(
    worktree: WorktreeSummary,
    checkpointCommit: string,
    projectRoot: string,
    paths: string[],
    selections: WorktreeHunkSelection[],
  ): Promise<WorktreeConflictSummary[]> {
    const conflicts: WorktreeConflictSummary[] = [];
    const fullPaths = paths.length || selections.length
      ? paths
      : (await this.evidence(worktree)).changes.map((change) => change.path);
    for (const path of fullPaths) {
      const patch = await this.checkpointFilePatch(worktree, checkpointCommit, path);
      const parsed = parseFilePatch(path, patch);
      const hunkIds: string[] = [];
      if (parsed.partialSelection) {
        for (const hunk of parsed.hunks) {
          if (!await this.patchApplies(projectRoot, `${parsed.header}${hunk.patch}`)) hunkIds.push(hunk.id);
        }
      }
      if (hunkIds.length || !await this.patchApplies(projectRoot, patch)) {
        conflicts.push({
          path,
          ...(hunkIds.length ? { hunkIds } : {}),
          detail: hunkIds.length
            ? `${hunkIds.length} ${hunkIds.length === 1 ? "hunk overlaps" : "hunks overlap"} with project edits.`
            : "The file overlaps with project edits and must be reviewed as a whole.",
        });
      }
    }
    for (const selection of selections) {
      const patch = await this.checkpointFilePatch(worktree, checkpointCommit, selection.path);
      const parsed = parseFilePatch(selection.path, patch);
      const byId = new Map(parsed.hunks.map((hunk) => [hunk.id, hunk]));
      const hunkIds: string[] = [];
      for (const id of selection.hunkIds) {
        const hunk = byId.get(id);
        if (hunk && !await this.patchApplies(projectRoot, `${parsed.header}${hunk.patch}`)) hunkIds.push(id);
      }
      if (hunkIds.length) conflicts.push({
        path: selection.path,
        hunkIds,
        detail: `${hunkIds.length} selected ${hunkIds.length === 1 ? "hunk overlaps" : "hunks overlap"} with project edits.`,
      });
    }
    return conflicts.length ? conflicts : [{ path: "Multiple files", detail: "The selected changes do not apply together. Apply a smaller selection to isolate the overlap." }];
  }

  private assertInside(root: string, candidate: string, message: string): void {
    const fromRoot = relative(root, candidate);
    if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) throw new TypeError(message);
  }

  private async snapshotProject(projectRoot: string, worktreeRoot: string): Promise<void> {
    const output = (await runGit(projectRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).stdout;
    const paths = [...new Set(output.split("\0").filter(Boolean))];
    const copiedLinks: Array<{ path: string; destination: string }> = [];
    for (const repositoryPath of paths) {
      const source = resolve(projectRoot, repositoryPath);
      const destination = resolve(worktreeRoot, repositoryPath);
      this.assertInside(projectRoot, source, "Git returned a project path outside the approved project.");
      this.assertInside(worktreeRoot, destination, "Git returned a project path outside the isolated worktree.");
      let sourceStat;
      try {
        sourceStat = await lstat(source);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await rm(destination, { force: true, recursive: true });
          continue;
        }
        throw error;
      }
      await mkdir(dirname(destination), { recursive: true });
      await rm(destination, { force: true, recursive: true });
      if (sourceStat.isSymbolicLink()) {
        let target: string;
        try {
          target = await realpath(source);
        } catch {
          throw new TypeError(`Build cannot snapshot the broken symlink "${repositoryPath}".`);
        }
        this.assertInside(projectRoot, target, `Build cannot snapshot the symlink "${repositoryPath}" because it points outside the approved project.`);
        const originalTarget = await readlink(source);
        const snapshotTarget = isAbsolute(originalTarget)
          ? relative(dirname(destination), join(worktreeRoot, relative(projectRoot, target)))
          : originalTarget;
        await symlink(snapshotTarget, destination);
        copiedLinks.push({ path: repositoryPath, destination });
      } else if (sourceStat.isFile()) {
        await copyFile(source, destination);
        await chmod(destination, sourceStat.mode & 0o777);
      } else {
        throw new TypeError(`Build cannot snapshot the unsupported repository entry "${repositoryPath}".`);
      }
    }
    for (const link of copiedLinks) {
      let target: string;
      try {
        target = await realpath(link.destination);
      } catch {
        throw new TypeError(`Build cannot materialize the symlink "${link.path}" inside the isolated worktree.`);
      }
      this.assertInside(worktreeRoot, target, `Build cannot materialize the symlink "${link.path}" inside the isolated worktree.`);
    }
  }
}
