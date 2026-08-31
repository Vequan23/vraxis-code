import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import type { TerminalRunSummary } from "@vraxis/code-contracts";
import { spawn, type IPty } from "node-pty";

interface TerminalData {
  schemaVersion: 1;
  runs: TerminalRunSummary[];
}

const emptyData: TerminalData = { schemaVersion: 1, runs: [] };
const maximumOutputBytes = 1024 * 1024;
const inheritedEnvironment = ["HOME", "LANG", "LC_ALL", "LOGNAME", "PATH", "SHELL", "TEMP", "TERM", "TMP", "TMPDIR", "USER"] as const;

function commandEnvironment(): Record<string, string> {
  return Object.fromEntries(inheritedEnvironment.flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

export function commandArguments(command: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  for (const character of command.trim()) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
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

async function resolveExecutable(executable: string, environment: Record<string, string>): Promise<string> {
  const candidates = isAbsolute(executable) || executable.includes("/")
    ? [resolve(executable)]
    : (environment.PATH ?? "").split(delimiter).filter(Boolean).map((directory) => resolve(directory, executable));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return realpath(candidate);
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
    const executablePath = await resolveExecutable(executable, environment);
    const startedAt = Date.now();
    await this.update(id, { status: "running", startedAt: new Date(startedAt).toISOString() });
    return new Promise((resolve) => {
      const child = spawn(executablePath, args, {
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
      child.onExit(async ({ exitCode, signal }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        abortSignal?.removeEventListener("abort", abort);
        this.processes.delete(id);
        await persistOutput();
        const status = signal ? "interrupted" : exitCode === 0 ? "success" : "error";
        const run = await this.update(id, {
          status,
          output,
          exitCode,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          outputTruncated: truncated,
        });
        resolve(run);
      });
    });
  }

  async interrupt(id: string): Promise<void> {
    const child = this.processes.get(id);
    if (!child) throw new TypeError("This command is not running.");
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
