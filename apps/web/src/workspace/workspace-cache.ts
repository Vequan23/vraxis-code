import type { BootstrapState } from "@vraxis/code-contracts";

export interface WorkspaceStateSnapshot {
  projectId: string;
  sessionId?: string;
  capturedAt: number;
  skills: BootstrapState["skills"];
  files: BootstrapState["files"];
  changes: BootstrapState["changes"];
  events: BootstrapState["events"];
  approvals: BootstrapState["approvals"];
  approvalRules: NonNullable<BootstrapState["approvalRules"]>;
  terminalRuns: BootstrapState["terminalRuns"];
  verificationRuns: NonNullable<BootstrapState["verificationRuns"]>;
  verificationHandoffs: NonNullable<BootstrapState["verificationHandoffs"]>;
  projectDoctor?: BootstrapState["projectDoctor"];
  browser?: BootstrapState["browser"];
}

export function cloneWorkspaceValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function workspaceCollectionsEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && JSON.stringify(left) === JSON.stringify(right);
}

export function workspaceStateKey(projectId: string, sessionId?: string): string {
  return `${projectId}:${sessionId ?? "draft"}`;
}

export function captureWorkspaceState(state: BootstrapState): WorkspaceStateSnapshot | undefined {
  if (!state.selectedProjectId) return undefined;
  return cloneWorkspaceValue({
    projectId: state.selectedProjectId,
    ...(state.selectedSessionId ? { sessionId: state.selectedSessionId } : {}),
    capturedAt: Date.now(),
    skills: state.skills,
    files: state.files,
    changes: state.changes,
    events: state.events,
    approvals: state.approvals,
    approvalRules: state.approvalRules ?? [],
    terminalRuns: state.terminalRuns,
    verificationRuns: state.verificationRuns ?? [],
    verificationHandoffs: state.verificationHandoffs ?? [],
    ...(state.projectDoctor ? { projectDoctor: state.projectDoctor } : {}),
    ...(state.browser ? { browser: state.browser } : {}),
  });
}

export function restoreWorkspaceState(state: BootstrapState, snapshot: WorkspaceStateSnapshot): void {
  state.selectedProjectId = snapshot.projectId;
  if (snapshot.sessionId) state.selectedSessionId = snapshot.sessionId;
  else delete state.selectedSessionId;
  state.skills = cloneWorkspaceValue(snapshot.skills);
  state.files = cloneWorkspaceValue(snapshot.files);
  state.changes = cloneWorkspaceValue(snapshot.changes);
  state.events = cloneWorkspaceValue(snapshot.events);
  state.approvals = cloneWorkspaceValue(snapshot.approvals);
  state.approvalRules = cloneWorkspaceValue(snapshot.approvalRules);
  state.terminalRuns = cloneWorkspaceValue(snapshot.terminalRuns);
  state.verificationRuns = cloneWorkspaceValue(snapshot.verificationRuns);
  state.verificationHandoffs = cloneWorkspaceValue(snapshot.verificationHandoffs);
  if (snapshot.projectDoctor) state.projectDoctor = cloneWorkspaceValue(snapshot.projectDoctor);
  else delete state.projectDoctor;
  if (snapshot.browser) state.browser = cloneWorkspaceValue(snapshot.browser);
  else delete state.browser;
}

export function resetWorkspaceState(state: BootstrapState, projectId: string, sessionId?: string): void {
  restoreWorkspaceState(state, {
    projectId,
    ...(sessionId ? { sessionId } : {}),
    capturedAt: Date.now(),
    skills: [],
    files: [],
    changes: [],
    events: [],
    approvals: [],
    approvalRules: [],
    terminalRuns: [],
    verificationRuns: [],
    verificationHandoffs: [],
  });
}
