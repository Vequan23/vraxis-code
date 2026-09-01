import type {
  BrowserActionRequest,
  BrowserConsoleEntry,
  BrowserControlSummary,
  BrowserNetworkEntry,
  BrowserTabSummary,
} from "@vraxis/code-contracts";

export interface BrowserAutomationObservation {
  sessionId: string;
  url: string;
  title: string;
  snapshot: string;
  viewport: { width: number; height: number };
  activeTabId: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  tabs: BrowserTabSummary[];
  controls: BrowserControlSummary[];
  console: BrowserConsoleEntry[];
  network: BrowserNetworkEntry[];
  screenshotBase64?: string;
}

export interface BrowserAutomationRelay {
  perform(input: BrowserActionRequest): Promise<BrowserAutomationObservation>;
  close(): void;
}

export function normalizeBrowserObservation(value: unknown, expectedSessionId: string): BrowserAutomationObservation {
  const input = record(value, "Embedded browser observation");
  if (input.sessionId !== expectedSessionId) throw new TypeError("Embedded browser observation belongs to another task.");
  const url = optionalString(input.url, 8_192);
  if (url) safeObservationUrl(url);
  const viewport = record(input.viewport, "Embedded browser viewport");
  const width = boundedNumber(viewport.width, 1, 20_000, "Embedded browser viewport width");
  const height = boundedNumber(viewport.height, 1, 20_000, "Embedded browser viewport height");
  const tabs = array(input.tabs, 32, "Embedded browser tabs").map((tab) => normalizeTab(tab));
  const activeTabId = optionalString(input.activeTabId, 128);
  if (activeTabId && !tabs.some((tab) => tab.id === activeTabId)) throw new TypeError("Embedded browser active tab is unavailable.");
  const controls = array(input.controls, 80, "Embedded browser controls").map((control, index) => normalizeControl(control, index));
  const consoleEntries = array(input.console, 100, "Embedded browser console").map(normalizeConsoleEntry);
  const network = array(input.network, 150, "Embedded browser network").map(normalizeNetworkEntry);
  const screenshotBase64 = input.screenshotBase64 === undefined ? undefined : optionalString(input.screenshotBase64, 16 * 1024 * 1024);
  if (screenshotBase64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(screenshotBase64)) throw new TypeError("Embedded browser screenshot is invalid.");
  return {
    sessionId: expectedSessionId,
    url,
    title: optionalString(input.title, 500),
    snapshot: optionalString(input.snapshot, 40_000),
    viewport: { width, height },
    activeTabId,
    ...(typeof input.loading === "boolean" ? { loading: input.loading } : {}),
    ...(typeof input.canGoBack === "boolean" ? { canGoBack: input.canGoBack } : {}),
    ...(typeof input.canGoForward === "boolean" ? { canGoForward: input.canGoForward } : {}),
    tabs,
    controls,
    console: consoleEntries,
    network,
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
  };
}

function normalizeTab(value: unknown): BrowserTabSummary {
  const input = record(value, "Embedded browser tab");
  const id = requiredId(input.id, "Embedded browser tab identifier");
  const url = optionalString(input.url, 8_192);
  if (url) safeObservationUrl(url);
  return { id, title: optionalString(input.title, 500) || "New tab", url, active: input.active === true };
}

function normalizeControl(value: unknown, index: number): BrowserControlSummary {
  const input = record(value, "Embedded browser control");
  const kind = String(input.kind ?? "");
  if (!["button", "link", "textbox", "checkbox", "radio", "combobox", "control"].includes(kind)) throw new TypeError("Embedded browser control kind is invalid.");
  const action = input.action === "type" ? "type" : input.action === "click" ? "click" : undefined;
  if (!action) throw new TypeError("Embedded browser control action is invalid.");
  const bounds = record(input.bounds, "Embedded browser control bounds");
  return {
    ref: `e${index + 1}`,
    kind: kind as BrowserControlSummary["kind"],
    label: optionalString(input.label, 140) || `${kind} ${index + 1}`,
    action,
    disabled: input.disabled === true,
    sensitive: input.sensitive === true,
    bounds: {
      x: boundedNumber(bounds.x, 0, 20_000, "Embedded browser control x"),
      y: boundedNumber(bounds.y, 0, 20_000, "Embedded browser control y"),
      width: boundedNumber(bounds.width, 1, 20_000, "Embedded browser control width"),
      height: boundedNumber(bounds.height, 1, 20_000, "Embedded browser control height"),
    },
  };
}

function normalizeConsoleEntry(value: unknown): BrowserConsoleEntry {
  const input = record(value, "Embedded browser console entry");
  const level = String(input.level ?? "");
  if (!["debug", "info", "warning", "error"].includes(level)) throw new TypeError("Embedded browser console level is invalid.");
  return {
    id: requiredId(input.id, "Embedded browser console identifier"),
    timestamp: safeTimestamp(input.timestamp),
    level: level as BrowserConsoleEntry["level"],
    text: optionalString(input.text, 4_000),
  };
}

function normalizeNetworkEntry(value: unknown): BrowserNetworkEntry {
  const input = record(value, "Embedded browser network entry");
  const state = String(input.state ?? "");
  if (!["pending", "success", "error", "blocked"].includes(state)) throw new TypeError("Embedded browser network state is invalid.");
  const url = redactedUrl(optionalString(input.url, 8_192));
  return {
    id: requiredId(input.id, "Embedded browser network identifier"),
    timestamp: safeTimestamp(input.timestamp),
    method: optionalString(input.method, 20) || "GET",
    url,
    resourceType: optionalString(input.resourceType, 80) || "other",
    state: state as BrowserNetworkEntry["state"],
    ...(input.status === undefined ? {} : { status: boundedNumber(input.status, 0, 999, "Embedded browser response status") }),
    ...(input.durationMs === undefined ? {} : { durationMs: boundedNumber(input.durationMs, 0, 86_400_000, "Embedded browser request duration") }),
    ...(input.failure === undefined ? {} : { failure: optionalString(input.failure, 500) }),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} are invalid.`);
  return value;
}

function optionalString(value: unknown, maximum: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maximum) throw new TypeError("Embedded browser text is invalid.");
  return value;
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value) || Number(value) < minimum || Number(value) > maximum) throw new TypeError(`${label} is invalid.`);
  return Math.round(Number(value));
}

function safeTimestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return new Date().toISOString();
  return value;
}

function safeObservationUrl(value: string): void {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("Embedded browser URL is invalid.");
  if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new TypeError("Remote embedded browser pages must use HTTPS.");
}

function redactedUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, "…");
    return url.href;
  } catch { return "[unavailable URL]"; }
}
