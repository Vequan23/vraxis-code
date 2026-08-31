import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { inspectProject, planProjectVerification, type ProjectDoctorReport } from "@vraxis/agent-v/node";
import type {
  ProjectDoctorSummary,
  VerificationBrowserAssertionDefinition,
  VerificationCheckDefinition,
  VerificationServiceDefinition,
  VerificationVisualDefinition,
} from "@vraxis/code-contracts";

export type ProjectInspector = (rootPath: string) => Promise<ProjectDoctorReport>;
export const defaultProjectInspector: ProjectInspector = inspectProject;
export type ProductProjectReport = ProjectDoctorReport & {
  verificationSource: NonNullable<ProjectDoctorSummary["verificationSource"]>;
  verificationServices: VerificationServiceDefinition[];
  verificationBrowserAssertions: VerificationBrowserAssertionDefinition[];
  verificationVisual?: VerificationVisualDefinition;
};

interface VerificationRecipeFile {
  schemaVersion?: unknown;
  checks?: unknown;
  services?: unknown;
  browser?: unknown;
}

const recipePath = ".vraxis/verify.json";
const categories = new Set(["lint", "typecheck", "test", "build", "check"]);

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) {
    throw new TypeError(`${label} must be a non-empty string no longer than ${maximum} characters.`);
  }
  return value.trim();
}

function browserTarget(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const target = new URL(text(value, "Verification browser URL", 2_048));
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new TypeError("Verification browser URL must use HTTP or HTTPS.");
  if (target.username || target.password) throw new TypeError("Verification browser URL cannot contain credentials.");
  if (target.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new TypeError("Remote verification browser URLs must use HTTPS.");
  }
  return target.href;
}

function serviceHealthTarget(value: unknown): string {
  const target = new URL(text(value, "Verification service health URL", 2_048));
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new TypeError("Verification service health URLs must use HTTP or HTTPS.");
  }
  if (target.username || target.password) throw new TypeError("Verification service health URLs cannot contain credentials.");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new TypeError("Verification service health URLs must use a loopback host.");
  }
  return target.href;
}

function projectCwd(rootPath: string, value: unknown): string {
  const cwd = value === undefined ? "." : text(value, "Verification working directory", 512).replace(/\\/g, "/");
  if (isAbsolute(cwd)) throw new TypeError("Verification working directories must be project-relative.");
  const absolute = resolve(rootPath, cwd);
  const fromRoot = relative(rootPath, absolute);
  if (fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) {
    throw new TypeError("Verification working directories must stay inside the project.");
  }
  return cwd || ".";
}

function projectFile(rootPath: string, value: unknown, label: string): string {
  const path = projectCwd(rootPath, text(value, label, 512));
  if (path === ".") throw new TypeError(`${label} must identify a project file.`);
  return path;
}

function boolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be true or false.`);
  return value;
}

function parseRecipe(rootPath: string, value: VerificationRecipeFile): {
  checks: VerificationCheckDefinition[];
  services: VerificationServiceDefinition[];
  browserAssertions: VerificationBrowserAssertionDefinition[];
  visual?: VerificationVisualDefinition;
  browserRequired: boolean;
  browserTarget?: string;
} {
  if (value.schemaVersion !== 1) throw new TypeError("Verification recipe schemaVersion must be 1.");
  if (value.checks !== undefined && !Array.isArray(value.checks)) throw new TypeError("Verification recipe checks must be an array.");
  if ((value.checks as unknown[] | undefined)?.length && (value.checks as unknown[]).length > 20) {
    throw new TypeError("Verification recipe checks must contain at most 20 commands.");
  }
  const identifiers = new Set<string>();
  const checks = ((value.checks ?? []) as unknown[]).map((raw, index): VerificationCheckDefinition => {
    if (!raw || typeof raw !== "object") throw new TypeError(`Verification check ${index + 1} must be an object.`);
    const input = raw as Record<string, unknown>;
    const id = text(input.id, `Verification check ${index + 1} id`, 64);
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Verification check id "${id}" is invalid.`);
    if (identifiers.has(id)) throw new TypeError(`Verification check id "${id}" is duplicated.`);
    identifiers.add(id);
    const category = input.category === undefined ? "check" : text(input.category, `Verification check ${id} category`, 20);
    if (!categories.has(category)) throw new TypeError(`Verification check ${id} has an unsupported category.`);
    const command = text(input.command, `Verification check ${id} command`, 256);
    if (/\s/.test(command)) throw new TypeError(`Verification check ${id} command must be one executable without arguments.`);
    if (input.args !== undefined && (!Array.isArray(input.args) || input.args.length > 64)) {
      throw new TypeError(`Verification check ${id} args must contain at most 64 strings.`);
    }
    const args = (input.args ?? []).map((argument, argumentIndex) => text(argument, `Verification check ${id} argument ${argumentIndex + 1}`, 4_096));
    const timeoutMs = input.timeoutMs === undefined ? 15 * 60_000 : Number(input.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60_000) {
      throw new TypeError(`Verification check ${id} timeoutMs must be between 1000 and 1800000.`);
    }
    return {
      id,
      title: input.title === undefined ? id : text(input.title, `Verification check ${id} title`, 120),
      category: category as VerificationCheckDefinition["category"],
      command,
      args,
      cwd: projectCwd(rootPath, input.cwd),
      required: boolean(input.required, `Verification check ${id} required`, true),
      timeoutMs,
      source: recipePath,
    };
  });
  if (value.services !== undefined && !Array.isArray(value.services)) throw new TypeError("Verification recipe services must be an array.");
  if (((value.services ?? []) as unknown[]).length > 8) throw new TypeError("Verification recipe services must contain at most 8 processes.");
  const serviceIdentifiers = new Set<string>();
  const services = ((value.services ?? []) as unknown[]).map((raw, index): VerificationServiceDefinition => {
    if (!raw || typeof raw !== "object") throw new TypeError(`Verification service ${index + 1} must be an object.`);
    const input = raw as Record<string, unknown>;
    const id = text(input.id, `Verification service ${index + 1} id`, 64);
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Verification service id "${id}" is invalid.`);
    if (serviceIdentifiers.has(id)) throw new TypeError(`Verification service id "${id}" is duplicated.`);
    serviceIdentifiers.add(id);
    const command = text(input.command, `Verification service ${id} command`, 256);
    if (/\s/.test(command)) throw new TypeError(`Verification service ${id} command must be one executable without arguments.`);
    if (input.args !== undefined && (!Array.isArray(input.args) || input.args.length > 64)) {
      throw new TypeError(`Verification service ${id} args must contain at most 64 strings.`);
    }
    const args = (input.args ?? []).map((argument, argumentIndex) => text(argument, `Verification service ${id} argument ${argumentIndex + 1}`, 4_096));
    if (!input.health || typeof input.health !== "object" || Array.isArray(input.health)) {
      throw new TypeError(`Verification service ${id} health must be an object.`);
    }
    const health = input.health as Record<string, unknown>;
    const expectedStatus = health.expectedStatus === undefined ? 200 : Number(health.expectedStatus);
    if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
      throw new TypeError(`Verification service ${id} expectedStatus must be between 100 and 599.`);
    }
    const timeoutMs = health.timeoutMs === undefined ? 60_000 : Number(health.timeoutMs);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      throw new TypeError(`Verification service ${id} health timeoutMs must be between 1000 and 120000.`);
    }
    const intervalMs = health.intervalMs === undefined ? 500 : Number(health.intervalMs);
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 5_000) {
      throw new TypeError(`Verification service ${id} health intervalMs must be between 100 and 5000.`);
    }
    return {
      id,
      title: input.title === undefined ? id : text(input.title, `Verification service ${id} title`, 120),
      command,
      args,
      cwd: projectCwd(rootPath, input.cwd),
      health: { url: serviceHealthTarget(health.url), expectedStatus, timeoutMs, intervalMs },
      source: recipePath,
    };
  });
  if (value.browser !== undefined && (!value.browser || typeof value.browser !== "object" || Array.isArray(value.browser))) {
    throw new TypeError("Verification recipe browser must be an object.");
  }
  const browser = (value.browser ?? {}) as Record<string, unknown>;
  const required = boolean(browser.required, "Verification browser required", false);
  const target = browserTarget(browser.url);
  if (target && !required) throw new TypeError("Verification browser URL requires browser.required to be true.");
  if (browser.assertions !== undefined && !Array.isArray(browser.assertions)) {
    throw new TypeError("Verification browser assertions must be an array.");
  }
  if (((browser.assertions ?? []) as unknown[]).length > 20) {
    throw new TypeError("Verification browser assertions must contain at most 20 items.");
  }
  const assertionIdentifiers = new Set<string>();
  const browserAssertions = ((browser.assertions ?? []) as unknown[]).map((raw, index): VerificationBrowserAssertionDefinition => {
    if (!raw || typeof raw !== "object") throw new TypeError(`Verification browser assertion ${index + 1} must be an object.`);
    const input = raw as Record<string, unknown>;
    const id = text(input.id, `Verification browser assertion ${index + 1} id`, 64);
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw new TypeError(`Verification browser assertion id "${id}" is invalid.`);
    if (assertionIdentifiers.has(id)) throw new TypeError(`Verification browser assertion id "${id}" is duplicated.`);
    assertionIdentifiers.add(id);
    const kind = text(input.kind, `Verification browser assertion ${id} kind`, 16);
    if (!new Set(["url", "title", "text"]).has(kind)) throw new TypeError(`Verification browser assertion ${id} has an unsupported kind.`);
    const match = input.match === undefined ? (kind === "url" ? "equals" : "contains") : text(input.match, `Verification browser assertion ${id} match`, 16);
    if (match !== "equals" && match !== "contains") throw new TypeError(`Verification browser assertion ${id} has an unsupported match.`);
    if (kind === "url" && match !== "equals") throw new TypeError(`Verification browser assertion ${id} URL match must be equals.`);
    const rawValue = text(input.value, `Verification browser assertion ${id} value`, 512);
    const assertionValue = kind === "url" ? browserTarget(rawValue)! : rawValue;
    return {
      id,
      title: input.title === undefined ? id : text(input.title, `Verification browser assertion ${id} title`, 120),
      kind: kind as VerificationBrowserAssertionDefinition["kind"],
      match,
      value: assertionValue,
      caseSensitive: boolean(input.caseSensitive, `Verification browser assertion ${id} caseSensitive`, false),
      source: recipePath,
    };
  });
  if (browserAssertions.length && (!required || !target)) {
    throw new TypeError("Verification browser assertions require browser.required and an explicit browser.url target.");
  }
  if (browser.visual !== undefined && (!browser.visual || typeof browser.visual !== "object" || Array.isArray(browser.visual))) {
    throw new TypeError("Verification browser visual must be an object.");
  }
  const visualInput = browser.visual as Record<string, unknown> | undefined;
  let visual: VerificationVisualDefinition | undefined;
  if (visualInput) {
    if (!required || !target) throw new TypeError("Verification visual comparison requires browser.required and an explicit browser.url target.");
    const baselinePath = projectFile(rootPath, visualInput.baseline, "Verification visual baseline");
    if (!baselinePath.toLowerCase().endsWith(".png")) throw new TypeError("Verification visual baseline must be a PNG file.");
    const maxDiffRatio = visualInput.maxDiffRatio === undefined ? 0.005 : Number(visualInput.maxDiffRatio);
    if (!Number.isFinite(maxDiffRatio) || maxDiffRatio < 0 || maxDiffRatio > 1) {
      throw new TypeError("Verification visual maxDiffRatio must be between 0 and 1.");
    }
    visual = { baselinePath, maxDiffRatio, source: recipePath };
  }
  if (!checks.length && !services.length && !required) {
    throw new TypeError("Verification recipe must declare a check, service, or required browser proof.");
  }
  return { checks, services, browserAssertions, ...(visual ? { visual } : {}), browserRequired: required, ...(target ? { browserTarget: target } : {}) };
}

async function projectRecipe(rootPath: string): Promise<ReturnType<typeof parseRecipe> | undefined> {
  const file = resolve(rootPath, recipePath);
  try {
    const approvedRoot = await realpath(rootPath);
    const actualFile = await realpath(file);
    const fromRoot = relative(approvedRoot, actualFile);
    if (fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) {
      throw new TypeError(`${recipePath} must resolve inside the approved project.`);
    }
    const fileStat = await stat(actualFile);
    if (!fileStat.isFile()) throw new TypeError(`${recipePath} must be a regular file.`);
    if (fileStat.size > 64 * 1024) throw new TypeError(`${recipePath} must be 64 KB or smaller.`);
    return parseRecipe(approvedRoot, JSON.parse(await readFile(actualFile, "utf8")) as VerificationRecipeFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new TypeError(`${recipePath} is not valid JSON.`);
    throw error;
  }
}

export async function inspectProductReport(rootPath: string, inspector: ProjectInspector = inspectProject): Promise<ProductProjectReport> {
  const report = await inspector(rootPath);
  const recipe = await projectRecipe(rootPath);
  if (!recipe) {
    const plan = planProjectVerification(report, []);
    return {
      ...report,
      verificationServices: [],
      verificationBrowserAssertions: [],
      verificationSource: {
        kind: "discovered",
        browserRequired: plan.browserRecommended,
        ...(report.devServers[0]?.suggestedUrl ? { browserTarget: report.devServers[0].suggestedUrl } : {}),
      },
    };
  }
  return {
    ...report,
    verificationChecks: recipe.checks,
    verificationServices: recipe.services,
    verificationBrowserAssertions: recipe.browserAssertions,
    ...(recipe.visual ? { verificationVisual: recipe.visual } : {}),
    issues: [
      ...report.issues.filter((issue) => issue.code !== "no-verification-checks"),
      { severity: "info", code: "project-verification-recipe", message: `Using ${recipePath} as the verification contract.` },
    ],
    ok: report.ok,
    verificationSource: {
      kind: "project",
      path: recipePath,
      browserRequired: recipe.browserRequired,
      ...(recipe.browserTarget ? { browserTarget: recipe.browserTarget } : {}),
    },
  };
}

export function productProjectDoctor(projectId: string, report: ProductProjectReport): ProjectDoctorSummary {
  return {
    schemaVersion: 1,
    projectId,
    projectName: report.projectName,
    projectKind: report.projectKind,
    ...(report.packageManager ? { packageManager: { ...report.packageManager } } : {}),
    ecosystems: report.ecosystems.map((item) => ({ ...item })),
    frameworks: report.frameworks.map((item) => ({ ...item })),
    verificationChecks: report.verificationChecks.map((item): VerificationCheckDefinition => ({ ...item, args: [...item.args] })),
    verificationServices: report.verificationServices.map((item) => ({ ...item, args: [...item.args], health: { ...item.health } })),
    verificationBrowserAssertions: report.verificationBrowserAssertions.map((item) => ({ ...item })),
    ...(report.verificationVisual ? { verificationVisual: { ...report.verificationVisual } } : {}),
    verificationSource: { ...report.verificationSource },
    devServers: report.devServers.map((item) => ({ ...item, args: [...item.args] })),
    issues: report.issues.map((item) => ({ ...item })),
    ok: report.ok,
  };
}

export async function inspectProductProject(projectId: string, rootPath: string, inspector: ProjectInspector = inspectProject): Promise<ProjectDoctorSummary> {
  return productProjectDoctor(projectId, await inspectProductReport(rootPath, inspector));
}

export function verificationChecks(report: ProductProjectReport, changedPaths: readonly string[]): {
  checks: VerificationCheckDefinition[];
  services: VerificationServiceDefinition[];
  browserAssertions: VerificationBrowserAssertionDefinition[];
  visual?: VerificationVisualDefinition;
  browserRecommended: boolean;
  browserTarget?: string;
} {
  const plan = planProjectVerification(report, changedPaths);
  const checks = report.verificationSource.kind === "project" ? report.verificationChecks : plan.checks;
  return {
    checks: checks.map((item) => ({ ...item, args: [...item.args] })),
    services: report.verificationServices.map((item) => ({ ...item, args: [...item.args], health: { ...item.health } })),
    browserAssertions: report.verificationBrowserAssertions.map((item) => ({ ...item })),
    ...(report.verificationVisual ? { visual: { ...report.verificationVisual } } : {}),
    browserRecommended: report.verificationSource.browserRequired,
    ...(report.verificationSource.browserTarget ? { browserTarget: report.verificationSource.browserTarget } : {}),
  };
}
