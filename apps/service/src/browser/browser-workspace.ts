import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext, type ConsoleMessage, type ElementHandle, type Page, type Request } from "playwright";
import type { ContextArtifact, CredentialStore, JsonObject } from "@vraxis/agent-v";
import type { BrowserController } from "@vraxis/agent-v/tools";
import type {
  BrowserActionRequest,
  BrowserActionFrameSummary,
  BrowserActionSummary,
  BrowserConsoleEntry,
  BrowserControlSummary,
  BrowserNetworkEntry,
  BrowserSessionSummary,
} from "@vraxis/code-contracts";
import { BrowserStateVault, type BrowserStorageState } from "./browser-state-vault.js";
import type { BrowserAutomationObservation, BrowserAutomationRelay } from "./browser-automation.js";
import { normalizeBrowserObservation } from "./browser-automation.js";

interface BrowserPage {
  id: string;
  page: Page;
  controls: Map<string, ElementHandle>;
  requests: Map<Request, { id: string; startedAt: number }>;
}

export interface BrowserActionReceipt {
  actor?: "user" | "agent";
  approvalId?: string;
}

interface SessionBrowser {
  browser: Browser;
  context: BrowserContext;
  pages: Map<string, BrowserPage>;
  activePageId: string;
  state: BrowserSessionSummary;
}

interface BrowserEvidenceData {
  schemaVersion: 1;
  sessions: BrowserSessionSummary[];
}

const viewport = { width: 1280, height: 820 } as const;
const maximumSnapshotCharacters = 40_000;
const maximumConsoleEntries = 100;
const maximumActions = 100;
const maximumFrames = 200;
const maximumNetworkEntries = 150;
const maximumControls = 80;
const maximumPersistedSessions = 250;
const emptyEvidenceData: BrowserEvidenceData = { schemaVersion: 1, sessions: [] };
const interactiveSelector = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=textbox]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=combobox]",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function safeUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TypeError("Enter a valid browser URL."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("Browser URLs must use HTTP or HTTPS.");
  if (url.username || url.password) throw new TypeError("Browser URLs cannot contain credentials.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new TypeError("Remote browser pages must use HTTPS.");
  }
  return url;
}

function consoleLevel(message: ConsoleMessage): BrowserConsoleEntry["level"] {
  if (message.type() === "error") return "error";
  if (message.type() === "warning") return "warning";
  if (message.type() === "debug") return "debug";
  return "info";
}

function controlKind(tag: string, role: string, type: string): BrowserControlSummary["kind"] {
  if (tag === "a" || role === "link") return "link";
  if (tag === "button" || role === "button" || ["button", "submit", "reset", "image"].includes(type)) return "button";
  if (type === "checkbox" || role === "checkbox") return "checkbox";
  if (type === "radio" || role === "radio") return "radio";
  if (tag === "select" || role === "combobox") return "combobox";
  if (tag === "input" || tag === "textarea" || role === "textbox") return "textbox";
  return "control";
}

function controlAction(kind: BrowserControlSummary["kind"]): BrowserControlSummary["action"] {
  return kind === "textbox" || kind === "combobox" ? "type" : "click";
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

function redactedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "…");
    return url.href;
  } catch {
    return "[unavailable URL]";
  }
}

function assertSessionId(sessionId: string): void {
  if (!/^[a-z0-9_-]{1,128}$/i.test(sessionId)) throw new TypeError("Browser session identifier is invalid.");
}

function isBrowserSessionSummary(value: unknown): value is BrowserSessionSummary {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BrowserSessionSummary>;
  return typeof state.sessionId === "string"
    && typeof state.url === "string"
    && typeof state.title === "string"
    && typeof state.snapshot === "string"
    && typeof state.screenshotVersion === "number"
    && typeof state.updatedAt === "string"
    && Array.isArray(state.tabs)
    && Array.isArray(state.controls)
    && Array.isArray(state.allowedOrigins)
    && Array.isArray(state.console)
    && Array.isArray(state.network)
    && Array.isArray(state.actions);
}

export class BrowserWorkspace {
  private readonly sessions = new Map<string, SessionBrowser>();
  private readonly captureDirectory: string;
  private readonly profileDirectory: string;
  private readonly evidenceFile: string;
  private readonly stateVault: BrowserStateVault | undefined;
  private readonly operationQueues = new Map<string, Promise<void>>();
  private mutations: Promise<void> = Promise.resolve();
  private readonly persistenceTimers = new Map<string, NodeJS.Timeout>();
  private readonly relayStates = new Map<string, BrowserSessionSummary>();
  private readonly relayRefreshes = new Map<string, Promise<BrowserSessionSummary>>();
  private readonly relayCapturedAt = new Map<string, number>();

  constructor(dataDirectory: string, credentials?: CredentialStore, private readonly relay?: BrowserAutomationRelay) {
    this.captureDirectory = join(dataDirectory, "browser-captures");
    this.profileDirectory = join(dataDirectory, "browser-profiles");
    this.evidenceFile = join(dataDirectory, "browser-evidence.json");
    this.stateVault = credentials ? new BrowserStateVault(dataDirectory, credentials) : undefined;
  }

  async state(sessionId: string): Promise<BrowserSessionSummary | undefined> {
    assertSessionId(sessionId);
    const relayed = this.relayStates.get(sessionId);
    if (relayed) return this.refreshRelay(sessionId);
    const active = this.sessions.get(sessionId)?.state;
    if (active) return structuredClone(active);
    const retained = await this.retainedState(sessionId);
    return retained ? { ...retained, status: "closed" } : undefined;
  }

  screenshotPath(sessionId: string): string {
    assertSessionId(sessionId);
    return join(this.captureDirectory, `${sessionId}.png`);
  }

  framePath(sessionId: string, frameId: string): string {
    if (!/^[a-z0-9_-]{1,128}$/i.test(sessionId) || !/^[0-9a-f-]{36}$/i.test(frameId)) {
      throw new TypeError("Browser frame identifier is invalid.");
    }
    return join(this.captureDirectory, `${sessionId}-${frameId}.png`);
  }

  async allowedOrigins(sessionId: string): Promise<string[]> {
    const state = this.relayStates.get(sessionId) ?? this.sessions.get(sessionId)?.state ?? await this.retainedState(sessionId);
    return [...(state?.allowedOrigins ?? [])];
  }

  async perform(input: BrowserActionRequest, receipt: BrowserActionReceipt = {}): Promise<BrowserSessionSummary> {
    assertSessionId(input.sessionId);
    const previous = this.operationQueues.get(input.sessionId) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => lock);
    this.operationQueues.set(input.sessionId, queued);
    await previous.catch(() => undefined);
    try {
      return this.relay ? await this.performRelayAction(input, receipt) : await this.performAction(input, receipt);
    } finally {
      release();
      if (this.operationQueues.get(input.sessionId) === queued) this.operationQueues.delete(input.sessionId);
    }
  }

  async observe(sessionId: string, value: unknown): Promise<BrowserSessionSummary> {
    if (!this.relay) throw new TypeError("The desktop browser relay is unavailable.");
    assertSessionId(sessionId);
    const observation = normalizeBrowserObservation(value, sessionId);
    return this.mergeRelayObservation(observation);
  }

  private async performRelayAction(input: BrowserActionRequest, receipt: BrowserActionReceipt): Promise<BrowserSessionSummary> {
    const relay = this.relay;
    if (!relay) throw new Error("The desktop browser relay is unavailable.");
    const actionId = randomUUID();
    const hasLiveState = this.relayStates.has(input.sessionId);
    let state = this.relayStates.get(input.sessionId) ?? await this.retainedState(input.sessionId) ?? this.emptyState(input.sessionId);
    const target = this.relayActionTarget(state, input);
    const beforeFrameId = input.action === "capture" ? undefined : await this.copyRelayFrame(state, actionId, "before");
    try {
      const relayInput = input.action === "capture" && !hasLiveState && state.url
        ? { sessionId: input.sessionId, action: "navigate" as const, target: state.url }
        : input;
      const observation = await relay.perform(relayInput);
      state = await this.mergeRelayObservation(observation);
      if (input.action === "navigate" && input.target) {
        const origin = safeUrl(input.target).origin;
        if (!state.allowedOrigins.includes(origin)) state.allowedOrigins.push(origin);
      }
      const afterFrameId = await this.copyRelayFrame(state, actionId, "after");
      this.recordActionState(state, actionId, input.action, target, "success", this.actionDetail(input.action, state), receipt, beforeFrameId, afterFrameId);
      this.relayStates.set(input.sessionId, state);
      await this.persistState(state);
      return structuredClone(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser action failed.";
      state.status = "error";
      state.error = message;
      state.updatedAt = new Date().toISOString();
      this.recordActionState(state, actionId, input.action, target, "error", message, receipt, beforeFrameId);
      this.relayStates.set(input.sessionId, state);
      await this.persistState(state);
      throw error;
    }
  }

  private async mergeRelayObservation(observation: BrowserAutomationObservation): Promise<BrowserSessionSummary> {
    const previous = this.relayStates.get(observation.sessionId) ?? await this.retainedState(observation.sessionId) ?? this.emptyState(observation.sessionId);
    const state: BrowserSessionSummary = {
      ...previous,
      status: "ready",
      url: observation.url,
      title: observation.title,
      snapshot: observation.snapshot,
      viewport: { ...observation.viewport },
      activeTabId: observation.activeTabId,
      tabs: structuredClone(observation.tabs),
      controls: structuredClone(observation.controls),
      console: structuredClone(observation.console),
      network: structuredClone(observation.network),
      updatedAt: new Date().toISOString(),
    };
    delete state.error;
    if (observation.screenshotBase64) {
      await mkdir(this.captureDirectory, { recursive: true, mode: 0o700 });
      if (process.platform !== "win32") await chmod(this.captureDirectory, 0o700);
      const screenshot = Buffer.from(observation.screenshotBase64, "base64");
      if (!screenshot.length || screenshot.length > 12 * 1024 * 1024) throw new TypeError("Embedded browser screenshot is outside the retained evidence limit.");
      await writeFile(this.screenshotPath(observation.sessionId), screenshot, { mode: 0o600 });
      if (process.platform !== "win32") await chmod(this.screenshotPath(observation.sessionId), 0o600);
      state.screenshotVersion += 1;
    }
    this.relayStates.set(observation.sessionId, state);
    this.relayCapturedAt.set(observation.sessionId, Date.now());
    await this.persistState(state);
    return structuredClone(state);
  }

  private async refreshRelay(sessionId: string, force = false): Promise<BrowserSessionSummary> {
    const relay = this.relay;
    if (!relay) throw new Error("The desktop browser relay is unavailable.");
    const current = this.relayStates.get(sessionId);
    if (!force && current && Date.now() - (this.relayCapturedAt.get(sessionId) ?? 0) < 350) return structuredClone(current);
    const existing = this.relayRefreshes.get(sessionId);
    if (existing) return structuredClone(await existing);
    const refresh = relay.perform({ sessionId, action: "capture" }).then(observation => this.mergeRelayObservation(observation));
    this.relayRefreshes.set(sessionId, refresh);
    try { return structuredClone(await refresh); }
    finally { if (this.relayRefreshes.get(sessionId) === refresh) this.relayRefreshes.delete(sessionId); }
  }

  private emptyState(sessionId: string): BrowserSessionSummary {
    return {
      sessionId,
      status: "opening",
      url: "",
      title: "",
      snapshot: "",
      screenshotVersion: 0,
      viewport: { ...viewport },
      activeTabId: "",
      tabs: [],
      controls: [],
      allowedOrigins: [],
      console: [],
      network: [],
      actions: [],
      frames: [],
      updatedAt: new Date().toISOString(),
    };
  }

  private async copyRelayFrame(
    state: BrowserSessionSummary,
    actionId: string,
    phase: BrowserActionFrameSummary["phase"],
  ): Promise<string | undefined> {
    if (!state.url || !state.screenshotVersion) return undefined;
    try { await stat(this.screenshotPath(state.sessionId)); } catch { return undefined; }
    const id = randomUUID();
    const path = this.framePath(state.sessionId, id);
    await copyFile(this.screenshotPath(state.sessionId), path);
    if (process.platform !== "win32") await chmod(path, 0o600);
    state.frames ??= [];
    state.frames.unshift({ id, actionId, phase, url: state.url, title: state.title, timestamp: new Date().toISOString(), screenshotVersion: state.screenshotVersion });
    state.frames.splice(maximumFrames);
    return id;
  }

  private relayActionTarget(state: BrowserSessionSummary, input: BrowserActionRequest): string {
    if (input.tabId) {
      const tabUrl = state.tabs.find((tab) => tab.id === input.tabId)?.url;
      return tabUrl ? redactedUrl(tabUrl) : "browser tab";
    }
    if (input.target) {
      const ref = input.target.replace(/^@/, "");
      const control = state.controls.find((item) => item.ref === ref);
      return control ? `${control.label} (${control.ref})` : input.action === "navigate" ? redactedUrl(input.target) : input.target;
    }
    return state.url ? redactedUrl(state.url) : "active page";
  }

  private async performAction(input: BrowserActionRequest, receipt: BrowserActionReceipt): Promise<BrowserSessionSummary> {
    const session = await this.open(input.sessionId, input.action !== "navigate" && input.action !== "new-tab");
    const actionId = randomUUID();
    const beforeFrameId = input.action === "capture" || this.activePage(session).page.url() === "about:blank"
      ? undefined
      : await this.captureActionFrame(session, actionId, "before");
    const pageBeforeAction = this.activePage(session);
    const target = this.actionTarget(session, input);
    try {
      if (input.action === "new-tab") {
        const page = await session.context.newPage();
        session.activePageId = this.pageEntry(session, page).id;
      } else if (input.action === "select-tab") {
        const tab = this.requestedTab(session, input.tabId);
        session.activePageId = tab.id;
        await tab.page.bringToFront();
      } else if (input.action === "close-tab") {
        const tab = this.requestedTab(session, input.tabId);
        await tab.page.close();
        if (!session.pages.size) {
          const page = await session.context.newPage();
          session.activePageId = this.pageEntry(session, page).id;
        } else if (!session.pages.has(session.activePageId)) {
          session.activePageId = [...session.pages.keys()][0]!;
        }
      } else if (input.action === "navigate") {
        if (!input.target) throw new TypeError("Navigation requires a URL.");
        const url = safeUrl(input.target);
        await pageBeforeAction.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!session.state.allowedOrigins.includes(url.origin)) session.state.allowedOrigins.push(url.origin);
      } else if (input.action === "click") {
        if (!input.target) throw new TypeError("Click requires a page control reference.");
        const control = this.controlHandle(pageBeforeAction, input.target);
        if (control) await control.click({ timeout: 15_000 });
        else await pageBeforeAction.page.locator(input.target).first().click({ timeout: 15_000 });
      } else if (input.action === "type") {
        if (!input.target) throw new TypeError("Type requires a page control reference.");
        if (input.value === undefined) throw new TypeError("Type requires text.");
        const control = this.controlHandle(pageBeforeAction, input.target);
        if (control) {
          const tagName = await control.evaluate((element) => (element as Element).tagName.toLowerCase());
          if (tagName === "select") await control.selectOption(input.value);
          else await control.fill(input.value, { timeout: 15_000 });
        } else {
          await pageBeforeAction.page.locator(input.target).first().fill(input.value, { timeout: 15_000 });
        }
      } else if (input.action === "reload") {
        await pageBeforeAction.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      } else if (input.action === "back") {
        await pageBeforeAction.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 });
      }
      const afterFrameId = await this.captureActionFrame(session, actionId, "after");
      this.recordAction(session, actionId, input.action, target, "success", this.actionDetail(input.action, session.state), receipt, beforeFrameId, afterFrameId);
      await Promise.all([this.persistState(session.state), this.persistBrowserState(input.sessionId, session.context)]);
      return structuredClone(session.state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser action failed.";
      session.state.status = "error";
      session.state.error = message;
      session.state.updatedAt = new Date().toISOString();
      const afterFrameId = await this.captureActionFrame(session, actionId, "after").catch(() => undefined);
      this.recordAction(session, actionId, input.action, target, "error", message, receipt, beforeFrameId, afterFrameId);
      await Promise.all([this.persistState(session.state), this.persistBrowserState(input.sessionId, session.context)]);
      throw error;
    }
  }

  controller(sessionId: string): BrowserController {
    return {
      currentUrl: async () => this.relay ? (await this.refreshRelay(sessionId)).url : this.activePage(await this.open(sessionId)).page.url(),
      snapshot: async () => this.snapshotResult(await this.captureState(sessionId)),
      consoleMessages: async () => {
        const state = await this.captureState(sessionId);
        const messages: JsonObject[] = state.console.map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          level: item.level,
          text: item.text,
        }));
        return { url: state.url, messages };
      },
      networkRequests: async () => {
        const state = await this.captureState(sessionId);
        const requests: JsonObject[] = state.network.map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          method: item.method,
          url: item.url,
          resourceType: item.resourceType,
          state: item.state,
          status: item.status ?? null,
          durationMs: item.durationMs ?? null,
          failure: item.failure ?? null,
        }));
        return { url: state.url, requests };
      },
      screenshot: async () => {
        const state = await this.captureState(sessionId);
        return { url: state.url, title: state.title, screenshotVersion: state.screenshotVersion, viewport: state.viewport };
      },
      wait: async (target, options) => this.waitForTarget(sessionId, target, options),
      navigate: async (url, options) => {
        const allowed = await this.allowedOrigins(sessionId);
        if (!allowed.includes(safeUrl(url).origin) && !options?.approvalId) throw new TypeError("The browser origin has not been approved in Vraxis Code.");
        return this.snapshotResult(await this.perform(
          { sessionId, action: "navigate", target: url },
          { actor: "agent", ...(options?.approvalId ? { approvalId: options.approvalId } : {}) },
        ));
      },
      click: async (target, options) => this.snapshotResult(await this.perform(
        { sessionId, action: "click", target },
        { actor: "agent", ...(options?.approvalId ? { approvalId: options.approvalId } : {}) },
      )),
      type: async (target, text, options) => this.snapshotResult(await this.perform(
        { sessionId, action: "type", target, value: text },
        { actor: "agent", ...(options?.approvalId ? { approvalId: options.approvalId } : {}) },
      )),
    };
  }

  private async waitForTarget(
    sessionId: string,
    target: string,
    options?: { abortSignal?: AbortSignal; timeoutMs?: number },
  ): Promise<JsonObject> {
    const timeoutMs = options?.timeoutMs ?? 15_000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (options?.abortSignal?.aborted) throw new Error("Browser wait was cancelled.");
      const state = await this.captureState(sessionId);
      const ref = target.trim().replace(/^@/, "");
      const matchedControl = /^e\d+$/.test(ref) && state.controls.some((control) => control.ref === ref && !control.disabled);
      const matchedText = !/^e\d+$/.test(ref) && state.snapshot.toLocaleLowerCase().includes(target.trim().toLocaleLowerCase());
      if (matchedControl || matchedText) return { matched: true, target, url: state.url, elapsedMs: Date.now() - startedAt };
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Browser target was not visible after ${timeoutMs}ms.`);
  }

  async contextArtifact(sessionId: string): Promise<ContextArtifact | undefined> {
    const current = this.sessions.get(sessionId);
    const liveRelay = this.relayStates.has(sessionId);
    const state = liveRelay ? await this.refreshRelay(sessionId) : current ? await this.capture(current) : await this.state(sessionId);
    if (!state?.url) return undefined;
    const retained = !current && !liveRelay;
    const controls = state.controls.length
      ? state.controls.map((control) => `${control.ref} [${control.kind}] ${control.label} (${control.action}${control.disabled ? ", disabled" : ""})`).join("\n")
      : "No visible interactive controls were found.";
    return {
      id: `browser-context:${sessionId}:${state.screenshotVersion}`,
      uri: state.url,
      mediaType: "text/plain",
      title: `${retained ? "Retained" : "Live"} browser context: ${state.title || state.url}`,
      content: [
        retained ? "State: retained evidence from the last browser capture; refresh before acting on a control." : "State: live browser capture.",
        `URL: ${state.url}`,
        `Title: ${state.title}`,
        "Interactive controls (use the ref with browser-click or browser-type):",
        controls,
        "Visible page text:",
        state.snapshot,
      ].join("\n"),
      metadata: { source: "vraxis-browser", screenshotVersion: state.screenshotVersion, activeTabId: state.activeTabId, retained },
    };
  }

  async close(): Promise<void> {
    for (const timer of this.persistenceTimers.values()) clearTimeout(timer);
    this.persistenceTimers.clear();
    this.relay?.close();
    const relayed = [...this.relayStates.values()];
    await Promise.all(relayed.map(async state => {
      state.status = "closed";
      state.updatedAt = new Date().toISOString();
      await this.persistState(state);
    }));
    const active = [...this.sessions.values()];
    await Promise.all(active.map(async (session) => {
      session.state.status = "closed";
      session.state.updatedAt = new Date().toISOString();
      await Promise.all([this.persistState(session.state), this.persistBrowserState(session.state.sessionId, session.context)]);
    }));
    await Promise.all(active.map(async (session) => {
      await session.context.close();
      await session.browser.close();
    }));
    for (const timer of this.persistenceTimers.values()) clearTimeout(timer);
    this.persistenceTimers.clear();
    this.sessions.clear();
    this.relayStates.clear();
    this.relayCapturedAt.clear();
  }

  private async captureState(sessionId: string): Promise<BrowserSessionSummary> {
    return this.relay ? this.refreshRelay(sessionId, true) : this.capture(await this.open(sessionId));
  }

  private async open(sessionId: string, restoreRetainedUrl = true): Promise<SessionBrowser> {
    assertSessionId(sessionId);
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const retained = await this.retainedState(sessionId);
    await Promise.all([
      mkdir(this.captureDirectory, { recursive: true, mode: 0o700 }),
      mkdir(this.profileDirectory, { recursive: true, mode: 0o700 }),
    ]);
    if (process.platform !== "win32") await Promise.all([chmod(this.captureDirectory, 0o700), chmod(this.profileDirectory, 0o700)]);
    const storageState = await this.loadBrowserState(sessionId, retained?.url);
    let browser: Browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      try {
        browser = await chromium.launch({ headless: true, channel: "chrome" });
      } catch {
        throw new Error(`The isolated browser could not start. Install Google Chrome or Playwright Chromium, then retry. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }
    let context: BrowserContext;
    try {
      context = await browser.newContext({ viewport, acceptDownloads: false, ...(storageState ? { storageState } : {}) });
    } catch (error) {
      await browser.close();
      throw error;
    }
    const timestamp = new Date().toISOString();
    const retainedWithoutError = retained ? structuredClone(retained) : undefined;
    if (retainedWithoutError) delete retainedWithoutError.error;
    const state: BrowserSessionSummary = retainedWithoutError ? {
      ...retainedWithoutError,
      status: "opening",
      viewport: { ...viewport },
      updatedAt: timestamp,
    } : {
      sessionId,
      status: "opening",
      url: "",
      title: "",
      snapshot: "",
      screenshotVersion: 0,
      viewport: { ...viewport },
      activeTabId: "",
      tabs: [],
      controls: [],
      allowedOrigins: [],
      console: [],
      network: [],
      actions: [],
      frames: [],
      updatedAt: timestamp,
    };
    const session: SessionBrowser = { browser, context, pages: new Map(), activePageId: "", state };
    context.on("page", (page) => {
      const entry = this.registerPage(session, page);
      session.activePageId = entry.id;
    });
    for (const page of context.pages()) this.registerPage(session, page);
    if (!session.pages.size) this.registerPage(session, await context.newPage());
    session.activePageId = [...session.pages.keys()][0]!;
    this.sessions.set(sessionId, session);
    if (restoreRetainedUrl && retained?.url && this.activePage(session).page.url() === "about:blank") {
      await this.activePage(session).page.goto(retained.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return session;
  }

  private async loadBrowserState(sessionId: string, retainedUrl?: string): Promise<BrowserStorageState | undefined> {
    if (!this.stateVault) return undefined;
    const encrypted = await this.stateVault.load(sessionId);
    if (encrypted) {
      await this.archiveLegacyProfileIfPresent(sessionId);
      return encrypted;
    }
    return this.migrateLegacyProfile(sessionId, retainedUrl);
  }

  private async migrateLegacyProfile(sessionId: string, retainedUrl?: string): Promise<BrowserStorageState | undefined> {
    if (!this.stateVault) return undefined;
    const profilePath = join(this.profileDirectory, sessionId);
    try {
      if (!(await stat(profilePath)).isDirectory()) return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profilePath, { headless: true, viewport, acceptDownloads: false });
    } catch (error) {
      try {
        context = await chromium.launchPersistentContext(profilePath, { headless: true, viewport, acceptDownloads: false, channel: "chrome" });
      } catch {
        throw new Error(`The legacy isolated browser profile could not be migrated into encrypted storage. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }
    try {
      if (retainedUrl) {
        const page = context.pages()[0] ?? await context.newPage();
        await context.route("**/*", async (route) => {
          await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Vraxis migration</title>" });
        });
        await page.goto(safeUrl(retainedUrl).href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await context.unrouteAll({ behavior: "wait" });
      }
      const storageState = await context.storageState({ indexedDB: true });
      await this.stateVault.save(sessionId, storageState);
      await context.close();
      await this.archiveLegacyProfileIfPresent(sessionId);
      return storageState;
    } catch (error) {
      await context.close().catch(() => undefined);
      throw new Error("The legacy isolated browser profile was preserved because encrypted migration did not complete.", { cause: error });
    }
  }

  private async archiveLegacyProfileIfPresent(sessionId: string): Promise<void> {
    const profilePath = join(this.profileDirectory, sessionId);
    try {
      if (!(await stat(profilePath)).isDirectory()) throw new Error("The legacy browser profile path is not a directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await rename(profilePath, await this.legacyArchivePath(sessionId));
  }

  private async legacyArchivePath(sessionId: string): Promise<string> {
    const preferred = join(this.profileDirectory, `${sessionId}.migrated`);
    try {
      await stat(preferred);
      return join(this.profileDirectory, `${sessionId}.migrated-${randomUUID()}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return preferred;
      throw error;
    }
  }

  private async persistBrowserState(sessionId: string, context: BrowserContext): Promise<void> {
    if (!this.stateVault) return;
    await this.stateVault.save(sessionId, await context.storageState({ indexedDB: true }));
  }

  private registerPage(session: SessionBrowser, page: Page): BrowserPage {
    const existing = [...session.pages.values()].find((entry) => entry.page === page);
    if (existing) return existing;
    const entry: BrowserPage = { id: randomUUID(), page, controls: new Map(), requests: new Map() };
    session.pages.set(entry.id, entry);
    page.on("console", (message) => {
      session.state.console.push({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        level: consoleLevel(message),
        text: message.text().slice(0, 4_000),
      });
      session.state.console.splice(0, Math.max(0, session.state.console.length - maximumConsoleEntries));
      this.schedulePersistence(session.state);
    });
    page.on("pageerror", (error) => {
      session.state.console.push({ id: randomUUID(), timestamp: new Date().toISOString(), level: "error", text: error.message.slice(0, 4_000) });
      this.schedulePersistence(session.state);
    });
    page.on("request", (request) => {
      const id = randomUUID();
      const startedAt = Date.now();
      entry.requests.set(request, { id, startedAt });
      session.state.network.unshift({
        id,
        timestamp: new Date(startedAt).toISOString(),
        method: request.method(),
        url: redactedUrl(request.url()),
        resourceType: request.resourceType(),
        state: "pending",
      });
      session.state.network.splice(maximumNetworkEntries);
      this.schedulePersistence(session.state);
    });
    page.on("response", (response) => {
      const request = response.request();
      const tracked = entry.requests.get(request);
      if (!tracked) return;
      const networkEntry = session.state.network.find((item) => item.id === tracked.id);
      if (networkEntry) {
        networkEntry.status = response.status();
        networkEntry.state = response.status() >= 400 ? "error" : "success";
        networkEntry.durationMs = Date.now() - tracked.startedAt;
      }
      entry.requests.delete(request);
      this.schedulePersistence(session.state);
    });
    page.on("requestfailed", (request) => {
      const tracked = entry.requests.get(request);
      if (!tracked) return;
      const networkEntry = session.state.network.find((item) => item.id === tracked.id);
      if (networkEntry) {
        networkEntry.state = "error";
        networkEntry.failure = (request.failure()?.errorText ?? "Request failed.").slice(0, 500);
        networkEntry.durationMs = Date.now() - tracked.startedAt;
      }
      entry.requests.delete(request);
      this.schedulePersistence(session.state);
    });
    page.on("download", (download) => {
      void download.cancel();
      const blocked: BrowserNetworkEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        method: "DOWNLOAD",
        url: redactedUrl(download.url()),
        resourceType: "download",
        state: "blocked",
        failure: `Blocked download: ${download.suggestedFilename().slice(0, 180)}`,
      };
      session.state.network.unshift(blocked);
      session.state.network.splice(maximumNetworkEntries);
      this.schedulePersistence(session.state);
    });
    page.on("close", () => {
      for (const handle of entry.controls.values()) void handle.dispose().catch(() => undefined);
      session.pages.delete(entry.id);
      if (session.activePageId === entry.id) session.activePageId = [...session.pages.keys()][0] ?? "";
      this.schedulePersistence(session.state);
    });
    return entry;
  }

  private pageEntry(session: SessionBrowser, page: Page): BrowserPage {
    return [...session.pages.values()].find((entry) => entry.page === page) ?? this.registerPage(session, page);
  }

  private activePage(session: SessionBrowser): BrowserPage {
    const page = session.pages.get(session.activePageId) ?? [...session.pages.values()][0];
    if (!page) throw new TypeError("The browser has no open page.");
    session.activePageId = page.id;
    return page;
  }

  private requestedTab(session: SessionBrowser, tabId: string | undefined): BrowserPage {
    if (!tabId) throw new TypeError("Choose a browser tab.");
    const tab = session.pages.get(tabId);
    if (!tab) throw new TypeError("That browser tab is no longer open.");
    return tab;
  }

  private controlHandle(page: BrowserPage, rawRef: string): ElementHandle | undefined {
    const ref = rawRef.trim().replace(/^@/, "");
    if (!/^e\d+$/.test(ref)) throw new TypeError("Choose a current numbered browser control such as e3.");
    const handle = page.controls.get(ref);
    if (!handle) throw new TypeError(`Control ${ref} is stale. Capture the page and choose it again.`);
    return handle;
  }

  private async capture(session: SessionBrowser): Promise<BrowserSessionSummary> {
    const active = this.activePage(session);
    const url = active.page.url();
    session.state.activeTabId = active.id;
    session.state.url = url === "about:blank" ? "" : url;
    session.state.title = await active.page.title().catch(() => "");
    session.state.snapshot = session.state.url
      ? (await active.page.locator("body").innerText({ timeout: 10_000 }).catch(() => "")).slice(0, maximumSnapshotCharacters)
      : "";
    session.state.controls = session.state.url ? await this.discoverControls(active) : [];
    session.state.tabs = await Promise.all([...session.pages.values()].map(async (entry) => ({
      id: entry.id,
      title: await entry.page.title().catch(() => "") || "New tab",
      url: entry.page.url() === "about:blank" ? "" : entry.page.url(),
      active: entry.id === active.id,
    })));
    if (session.state.url) {
      const screenshot = await active.page.screenshot({ type: "png", fullPage: false, animations: "disabled", timeout: 10_000 });
      await writeFile(this.screenshotPath(session.state.sessionId), screenshot, { mode: 0o600 });
      await chmod(this.screenshotPath(session.state.sessionId), 0o600);
      session.state.screenshotVersion += 1;
    }
    session.state.status = "ready";
    delete session.state.error;
    session.state.updatedAt = new Date().toISOString();
    await this.persistState(session.state);
    return structuredClone(session.state);
  }

  private async captureActionFrame(
    session: SessionBrowser,
    actionId: string,
    phase: BrowserActionFrameSummary["phase"],
  ): Promise<string | undefined> {
    await this.capture(session);
    if (!session.state.url) return undefined;
    const id = randomUUID();
    const path = this.framePath(session.state.sessionId, id);
    await copyFile(this.screenshotPath(session.state.sessionId), path);
    await chmod(path, 0o600);
    const frame: BrowserActionFrameSummary = {
      id,
      actionId,
      phase,
      url: session.state.url,
      title: session.state.title,
      timestamp: new Date().toISOString(),
      screenshotVersion: session.state.screenshotVersion,
    };
    session.state.frames ??= [];
    session.state.frames.unshift(frame);
    session.state.frames.splice(maximumFrames);
    return id;
  }

  private async discoverControls(page: BrowserPage): Promise<BrowserControlSummary[]> {
    await Promise.all([...page.controls.values()].map((handle) => handle.dispose().catch(() => undefined)));
    page.controls.clear();
    const handles = (await page.page.locator(interactiveSelector).elementHandles()).slice(0, 240);
    const controls: BrowserControlSummary[] = [];
    for (const handle of handles) {
      if (controls.length >= maximumControls) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const bounds = await handle.boundingBox().catch(() => null);
      if (!bounds || bounds.width < 2 || bounds.height < 2 || !(await handle.isVisible().catch(() => false))) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const details = await handle.evaluate((element) => {
        const html = element as HTMLElement;
        const input = element as HTMLInputElement;
        const labels = "labels" in input && input.labels ? [...input.labels].map((label) => label.textContent ?? "").join(" ") : "";
        return {
          tag: html.tagName.toLowerCase(),
          role: html.getAttribute("role")?.toLowerCase() ?? "",
          type: input.type?.toLowerCase() ?? "",
          label: html.getAttribute("aria-label") ?? labels ?? "",
          placeholder: input.placeholder ?? "",
          title: html.getAttribute("title") ?? "",
          text: html.innerText ?? element.textContent ?? "",
          disabled: Boolean(input.disabled) || html.getAttribute("aria-disabled") === "true",
          autocomplete: input.autocomplete?.toLowerCase() ?? "",
        };
      }).catch(() => undefined);
      if (!details) {
        await handle.dispose().catch(() => undefined);
        continue;
      }
      const kind = controlKind(details.tag, details.role, details.type);
      const ref = `e${controls.length + 1}`;
      const label = cleanLabel(details.label || details.placeholder || details.title || details.text) || `${kind} ${controls.length + 1}`;
      const sensitive = details.type === "password" || ["current-password", "new-password", "one-time-code"].includes(details.autocomplete);
      controls.push({
        ref,
        kind,
        label,
        action: controlAction(kind),
        disabled: details.disabled,
        sensitive,
        bounds: {
          x: Math.max(0, Math.round(bounds.x)),
          y: Math.max(0, Math.round(bounds.y)),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
        },
      });
      page.controls.set(ref, handle);
    }
    return controls;
  }

  private actionTarget(session: SessionBrowser, input: BrowserActionRequest): string {
    if (input.tabId) {
      const tabUrl = session.pages.get(input.tabId)?.page.url();
      return tabUrl ? redactedUrl(tabUrl) : "browser tab";
    }
    if (input.target) {
      const ref = input.target.replace(/^@/, "");
      const control = session.state.controls.find((item) => item.ref === ref);
      return control ? `${control.label} (${control.ref})` : input.action === "navigate" ? redactedUrl(input.target) : input.target;
    }
    return session.state.url ? redactedUrl(session.state.url) : "active page";
  }

  private actionDetail(action: BrowserActionSummary["action"], state: BrowserSessionSummary): string {
    if (action === "new-tab") return "Opened a new isolated browser tab.";
    if (action === "select-tab") return `Switched to ${state.title || state.url || "a new tab"}.`;
    if (action === "close-tab") return "Closed the browser tab.";
    if (action === "capture") return `Captured ${state.controls.length} visible page controls with the current screenshot.`;
    return `${action} completed on ${state.url || "the active page"}.`;
  }

  private recordAction(
    session: SessionBrowser,
    id: string,
    action: BrowserActionSummary["action"],
    target: string,
    status: BrowserActionSummary["status"],
    detail: string,
    receipt: BrowserActionReceipt,
    beforeFrameId?: string,
    afterFrameId?: string,
  ): void {
    this.recordActionState(session.state, id, action, target, status, detail, receipt, beforeFrameId, afterFrameId);
  }

  private recordActionState(
    state: BrowserSessionSummary,
    id: string,
    action: BrowserActionSummary["action"],
    target: string,
    status: BrowserActionSummary["status"],
    detail: string,
    receipt: BrowserActionReceipt,
    beforeFrameId?: string,
    afterFrameId?: string,
  ): void {
    state.actions.unshift({
      id,
      action,
      target: target.slice(0, 240),
      status,
      timestamp: new Date().toISOString(),
      detail,
      screenshotVersion: state.screenshotVersion,
      ...(receipt.actor ? { actor: receipt.actor } : {}),
      ...(receipt.approvalId ? { approvalId: receipt.approvalId } : {}),
      ...(beforeFrameId ? { beforeFrameId } : {}),
      ...(afterFrameId ? { afterFrameId } : {}),
    });
    state.actions.splice(maximumActions);
  }

  private schedulePersistence(state: BrowserSessionSummary): void {
    const existing = this.persistenceTimers.get(state.sessionId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistenceTimers.delete(state.sessionId);
      void this.persistState(state);
    }, 100);
    timer.unref();
    this.persistenceTimers.set(state.sessionId, timer);
  }

  private async retainedState(sessionId: string): Promise<BrowserSessionSummary | undefined> {
    const data = await this.readEvidence();
    const state = data.sessions.find((item) => item.sessionId === sessionId);
    return state ? structuredClone(state) : undefined;
  }

  private async persistState(state: BrowserSessionSummary): Promise<void> {
    const snapshot = structuredClone(state);
    const mutation = this.mutations.then(async () => {
      const data = await this.readEvidenceSnapshot();
      const index = data.sessions.findIndex((item) => item.sessionId === snapshot.sessionId);
      if (index >= 0) data.sessions[index] = snapshot;
      else data.sessions.unshift(snapshot);
      data.sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      data.sessions.splice(maximumPersistedSessions);
      await this.writeEvidence(data);
    });
    this.mutations = mutation.catch(() => undefined);
    await mutation;
  }

  private async readEvidence(): Promise<BrowserEvidenceData> {
    await this.mutations;
    return this.readEvidenceSnapshot();
  }

  private async readEvidenceSnapshot(): Promise<BrowserEvidenceData> {
    try {
      const parsed = JSON.parse(await readFile(this.evidenceFile, "utf8")) as BrowserEvidenceData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions) || !parsed.sessions.every(isBrowserSessionSummary)) {
        throw new Error("Unsupported browser evidence registry.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyEvidenceData);
      throw error;
    }
  }

  private async writeEvidence(data: BrowserEvidenceData): Promise<void> {
    await mkdir(dirname(this.evidenceFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.evidenceFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.evidenceFile);
  }

  private snapshotResult(state: BrowserSessionSummary): JsonObject {
    return {
      url: state.url,
      title: state.title,
      visibleText: state.snapshot,
      screenshotVersion: state.screenshotVersion,
      activeTabId: state.activeTabId,
      interactiveControls: state.controls.map((control) => ({
        ref: control.ref,
        kind: control.kind,
        label: control.label,
        action: control.action,
        disabled: control.disabled,
      })),
      consoleErrors: state.console.filter((item) => item.level === "error").map((item) => item.text),
      networkErrors: state.network.filter((item) => item.state === "error" || item.state === "blocked").map((item): JsonObject => ({
        method: item.method,
        url: item.url,
        status: item.status ?? null,
        failure: item.failure ?? null,
      })),
    };
  }
}
