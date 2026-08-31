import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import type { TerminalRunSummary } from "@vraxis/code-contracts";
import { spawn, type IPty } from "node-pty";

interface TerminalData {
  schemaVersion: 1;
  runs: TerminalRunSummary[];
}

const emptyData: TerminalData = { schemaVersion: 1, runs: [] };
const maximumOutputBytes = 1024 * 1024;
const inheritedEnvironment = [
  "APPDATA",
  "COLORTERM",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "SHELL",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "USER",
  "USERPROFILE",
  "WINDIR",
] as const;

function commandEnvironment(): Record<string, string> {
  return Object.fromEntries(inheritedEnvironment.flatMap((name) => {
    const value = process.env[name]
      ?? Object.entries(process.env).find(([candidate]) => candidate.toUpperCase() === name)?.[1];
    return value === undefined ? [] : [[name, value]];
  }));
}

export function commandArguments(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  const source = command.trim();
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      const next = source[index + 1];
      const escapable = next === "\\" || next === '"' || (!quote && next !== undefined && /\s/.test(next));
      if (escapable) {
        escaping = true;
        continue;
      }
      current += character;
      continue;
    }
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) result.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaping || quote) throw new TypeError("Command contains an unfinished quote or escape.");
  if (current) result.push(current);
  if (!result.length) throw new TypeError("Command must be a non-empty executable and arguments.");
  return result;
}

interface ResolvedCommand {
  executable: string;
  prefixArguments: string[];
}

function executableCandidates(executable: string, environment: Record<string, string>): string[] {
  const paths = isAbsolute(executable) || executable.includes("/") || executable.includes("\\")
    ? [resolve(executable)]
    : (environment.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => resolve(directory, executable));
  if (process.platform !== "win32" || extname(executable)) return paths;
  const extensions = (environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => [".com", ".exe", ".bat", ".cmd"].includes(extension));
  return paths.flatMap((candidate) => [candidate, ...extensions.map((extension) => `${candidate}${extension}`)]);
}

async function nodeShim(commandPath: string, environment: Record<string, string>): Promise<ResolvedCommand | undefined> {
  if (process.platform !== "win32" || !/[.](?:cmd|bat)$/i.test(commandPath)) return undefined;
  const source = await readFile(commandPath, "utf8");
  if (Buffer.byteLength(source) > 64 * 1024) return undefined;
  const matches = [...source.matchAll(/["']%dp0%[\\/]([^"']+[.](?:c?m?js))["']\s+%\*/gi)];
  const shimName = basename(commandPath).replace(/[.](?:cmd|bat)$/i, "").toLowerCase();
  const knownNpmEntry = shimName === "npm" || shimName === "npx"
    ? `node_modules/npm/bin/${shimName}-cli.js`
    : undefined;
  const relativeEntry = matches.at(-1)?.[1] ?? knownNpmEntry;
  if (!relativeEntry) return undefined;
  const entry = resolve(dirname(commandPath), relativeEntry.replace(/[\\/]+/g, "/"));
  try {
    if (!(await stat(entry)).isFile()) return undefined;
  } catch {
    return undefined;
  }
  const node = await resolveExecutable("node", environment, false);
  return { executable: node.executable, prefixArguments: [entry] };
}

async function resolveExecutable(
  executable: string,
  environment: Record<string, string>,
  unwrapNodeShims = true,
): Promise<ResolvedCommand> {
  const candidates = executableCandidates(executable, environment);
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      const actual = await realpath(candidate);
      if (unwrapNodeShims && process.platform === "win32" && /[.](?:cmd|bat)$/i.test(actual)) {
        const unwrapped = await nodeShim(actual, environment);
        if (unwrapped) return unwrapped;
        continue;
      }
      return { executable: actual, prefixArguments: [] };
    } catch {
      // Keep searching the inherited PATH without invoking a shell.
    }
  }
  throw new TypeError(`Command executable was not found: ${executable}`);
}

export class TerminalRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();
  private readonly processes = new Map<string, IPty>();
  private readonly executions = new Map<string, Promise<TerminalRunSummary>>();
  private readonly interrupted = new Set<string>();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "terminal-runs.json");
  }

  async list(sessionId?: string): Promise<TerminalRunSummary[]> {
    const data = await this.read();
    return data.runs.filter((item) => !sessionId || item.sessionId === sessionId);
  }

  async prepare(sessionId: string, approvalId: string, command: string, cwd: string): Promise<TerminalRunSummary> {
    commandArguments(command);
    return this.mutate((data) => {
      const run: TerminalRunSummary = {
        id: randomUUID(),
        sessionId,
        approvalId,
        command,
        cwd,
        status: "pending",
        output: "",
        terminalKind: "pty",
        columns: 100,
        rows: 30,
        outputVersion: 0,
      };
      data.runs.unshift(run);
      return run;
    });
  }

  async execute(id: string, absoluteCwd: string, abortSignal?: AbortSignal, maximumDurationMs = 30 * 60_000): Promise<TerminalRunSummary> {
    if (!Number.isInteger(maximumDurationMs) || maximumDurationMs < 1_000 || maximumDurationMs > 30 * 60_000) {
      throw new TypeError("Command timeout must be between 1 second and 30 minutes.");
    }
    const prepared = await this.get(id);
    const [executable, ...args] = commandArguments(prepared.command);
    if (!executable) throw new TypeError("Command executable is missing.");
    const environment = commandEnvironment();
    const resolvedCommand = await resolveExecutable(executable, environment);
    const startedAt = Date.now();
    await this.update(id, { status: "running", startedAt: new Date(startedAt).toISOString() });
    const execution = new Promise<TerminalRunSummary>((resolve, reject) => {
      const child = spawn(resolvedCommand.executable, [...resolvedCommand.prefixArguments, ...args], {
        cwd: absoluteCwd,
        env: environment,
        name: "xterm-256color",
        cols: 100,
        rows: 30,
      });
      this.processes.set(id, child);
      let output = "";
      let outputVersion = prepared.outputVersion ?? 0;
      let truncated = false;
      let flushTimer: NodeJS.Timeout | undefined;
      let flushes: Promise<unknown> = Promise.resolve();
      let settled = false;
      const persistOutput = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = undefined;
        outputVersion += 1;
        flushes = flushes.then(() => this.update(id, {
          output,
          outputTruncated: truncated,
          lastOutputAt: new Date().toISOString(),
          outputVersion,
        }));
        return flushes;
      };
      const scheduleOutput = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => void persistOutput(), 75);
      };
      const append = (chunk: string) => {
        if (truncated) return;
        const next = output + String(chunk);
        if (Buffer.byteLength(next) > maximumOutputBytes) {
          output = `${Buffer.from(next).subarray(0, maximumOutputBytes).toString("utf8")}\n[Output truncated at 1 MB]\n`;
          truncated = true;
        } else output = next;
        scheduleOutput();
      };
      child.onData(append);
      const terminate = (signal = "SIGTERM") => this.terminateProcess(child, signal);
      const timeout = setTimeout(() => terminate(), maximumDurationMs);
      const abort = () => terminate();
      abortSignal?.addEventListener("abort", abort, { once: true });
      child.onExit(({ exitCode, signal }) => void (async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", abort);
        this.processes.delete(id);
        await persistOutput();
        const status = signal || this.interrupted.has(id) ? "interrupted" : exitCode === 0 ? "success" : "error";
        this.interrupted.delete(id);
        const run = await this.update(id, {
          status,
          output,
          exitCode,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          outputTruncated: truncated,
        });
        resolve(run);
      })().catch(reject));
    });
    this.executions.set(id, execution);
    return execution.finally(() => this.executions.delete(id));
  }

  async interrupt(id: string): Promise<void> {
    const child = this.processes.get(id);
    if (!child) throw new TypeError("This command is not running.");
    this.interrupted.add(id);
    this.terminateProcess(child);
  }

  async input(id: string, data: string): Promise<void> {
    const child = this.processes.get(id);
    if (!child) throw new TypeError("This terminal is not running.");
    if (!data || Buffer.byteLength(data) > 16_384) throw new TypeError("Terminal input must be between 1 byte and 16 KB.");
    child.write(data);
  }

  async resize(id: string, columns: number, rows: number): Promise<TerminalRunSummary> {
    if (!Number.isInteger(columns) || columns < 20 || columns > 400 || !Number.isInteger(rows) || rows < 5 || rows > 200) {
      throw new TypeError("Terminal size is outside the supported range.");
    }
    const child = this.processes.get(id);
    if (!child) throw new TypeError("This terminal is not running.");
    child.resize(columns, rows);
    return this.update(id, { columns, rows });
  }

  async deny(id: string): Promise<TerminalRunSummary> {
    const run = await this.get(id);
    if (run.status !== "pending") throw new TypeError("Only a pending command can be denied.");
    return this.update(id, {
      status: "interrupted",
      output: "[Command denied]\n",
      completedAt: new Date().toISOString(),
    });
  }

  async close(): Promise<void> {
    const active = [...this.executions.values()];
    for (const [id, child] of this.processes) {
      this.interrupted.add(id);
      this.terminateProcess(child);
    }
    if (active.length) {
      const settled = Promise.allSettled(active);
      await Promise.race([settled, this.closeDeadline(1_500)]);
      if (this.processes.size) {
        for (const child of this.processes.values()) this.terminateProcess(child, "SIGKILL");
        await Promise.race([settled, this.closeDeadline(1_500)]);
      }
    }
    await this.reconcile();
  }

  async reconcile(): Promise<void> {
    await this.mutate((data) => {
      for (const run of data.runs) {
        if (run.status === "pending" || run.status === "running") {
          run.status = "interrupted";
          run.completedAt = new Date().toISOString();
          run.output = `${run.output}${run.output ? "\n" : ""}[Interrupted when Vraxis Code restarted]\n`;
        }
      }
    }, false);
  }

  private async get(id: string): Promise<TerminalRunSummary> {
    const data = await this.read();
    const run = data.runs.find((item) => item.id === id);
    if (!run) throw new TypeError("Terminal run was not found.");
    return run;
  }

  private terminateProcess(child: IPty, signal = "SIGTERM"): void {
    child.kill(signal);
  }

  private closeDeadline(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref();
    });
  }

  private async update(id: string, changes: Partial<TerminalRunSummary>): Promise<TerminalRunSummary> {
    return this.mutate((data) => {
      const run = data.runs.find((item) => item.id === id);
      if (!run) throw new TypeError("Terminal run was not found.");
      Object.assign(run, changes);
      return run;
    });
  }

  private async read(): Promise<TerminalData> {
    await this.mutations;
    return this.readSnapshot();
  }

  private async readSnapshot(): Promise<TerminalData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as TerminalData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.runs)) throw new Error("Unsupported terminal registry.");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(change: (data: TerminalData) => T, alwaysWrite = true): Promise<T> {
    let result!: T;
    const mutation = this.mutations.then(async () => {
      const data = await this.readSnapshot();
      const before = alwaysWrite ? "" : JSON.stringify(data);
      result = change(data);
      if (alwaysWrite || JSON.stringify(data) !== before) await this.write(data);
    });
    this.mutations = mutation.catch(() => undefined);
    await mutation;
    return result;
  }

  private async write(data: TerminalData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
