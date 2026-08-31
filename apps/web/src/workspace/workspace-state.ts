import { inspectorViews, type BootstrapState, type InspectorView, type SessionMode } from "@vraxis/code-contracts";

export function selectedProject(state: BootstrapState) {
  return state.projects.find((project) => project.id === state.selectedProjectId);
}

export function selectedSession(state: BootstrapState) {
  return state.sessions.find((session) => session.id === state.selectedSessionId);
}

export function normalizeInspector(value: unknown): InspectorView {
  const candidate = String(value).toLowerCase();
  return inspectorViews.includes(candidate as InspectorView)
    ? candidate as InspectorView
    : "files";
}

export function normalizeMode(value: unknown): SessionMode {
  const candidate = String(value).toLowerCase();
  return (["ask", "plan", "build", "review"] as const).includes(candidate as SessionMode)
    ? candidate as SessionMode
    : "ask";
}
