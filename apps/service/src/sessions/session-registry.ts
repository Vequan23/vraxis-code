import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ActivityEvent,
  AppendMessageRequest,
  CreateSessionRequest,
  PromptAttachment,
  SkillReference,
  WorktreeConflictSummary,
  WorktreeHunkSelection,
  WorktreeSummary,
  SessionEventsResponse,
  SessionSummary,
  SteeringDelivery,
} from "@vraxis/code-contracts";

interface SessionData {
  schemaVersion: 1;
  selectedSessionId?: string;
  draftProjectId?: string;
  sessions: SessionSummary[];
  events: ActivityEvent[];
}

export interface SessionStreamUpdate extends SessionEventsResponse {
  cursor: number;
}

export interface PendingSteeringInput {
  eventId: string;
  prompt: string;
  attachments: PromptAttachment[];
  skillIds: string[];
  delivery: SteeringDelivery;
}

const emptyData: SessionData = { schemaVersion: 1, sessions: [], events: [] };

function titleFrom(prompt: string): string {
  const firstLine = prompt.split("\n", 1)[0]?.trim() || "New task";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
}

export class SessionRegistry {
  readonly file: string;
  private mutations: Promise<void> = Promise.resolve();
  private readonly streamListeners = new Map<string, Set<(update: SessionStreamUpdate) => void>>();

  constructor(dataDirectory: string) {
    this.file = join(dataDirectory, "sessions.json");
  }

  async read(): Promise<SessionData> {
    await this.mutations;
    return this.readSnapshot();
  }

  subscribe(sessionId: string, listener: (update: SessionStreamUpdate) => void): () => void {
    const listeners = this.streamListeners.get(sessionId) ?? new Set<(update: SessionStreamUpdate) => void>();
    listeners.add(listener);
    this.streamListeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.streamListeners.delete(sessionId);
    };
  }

  async streamSnapshot(sessionId: string): Promise<SessionStreamUpdate> {
    const update = await this.events(sessionId);
    return { ...update, cursor: update.events.at(-1)?.sequence ?? 0 };
  }

  async create(
    input: CreateSessionRequest,
    skills: SkillReference[] = [],
    worktree?: WorktreeSummary,
  ): Promise<SessionSummary> {
    return this.mutate((data) => {
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const session: SessionSummary = {
        id,
        projectId: input.projectId,
        title: titleFrom(input.prompt),
        mode: input.mode,
        runtimeId: input.runtimeId,
        ...(input.modelId ? { modelId: input.modelId } : {}),
        updatedAt: timestamp,
        status: "idle",
        ...(worktree ? { worktree } : {}),
      };
      data.sessions.unshift(session);
      data.selectedSessionId = id;
      delete data.draftProjectId;
      data.events.push(this.userEvent(session, input.prompt, 1, timestamp, input.attachments, skills));
      return session;
    });
  }

  async append(sessionId: string, input: AppendMessageRequest, skills: SkillReference[] = []): Promise<ActivityEvent> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status === "running") throw new TypeError("Stop the current run before sending another message.");
      const nextMode = input.mode ?? session.mode;
      if (nextMode === "build" && session.worktree && session.worktree.status !== "active") {
        throw new TypeError("These changes were already applied. Start a new Build task for additional edits.");
      }
      if (input.mode) session.mode = input.mode;
      if (input.runtimeId) session.runtimeId = input.runtimeId;
      if (input.modelId === null) delete session.modelId;
      else if (input.modelId) session.modelId = input.modelId;
      const timestamp = new Date().toISOString();
      const event = this.userEvent(session, input.prompt, this.nextSequence(data, sessionId), timestamp, input.attachments, skills);
      data.events.push(event);
      session.updatedAt = timestamp;
      session.status = "idle";
      data.selectedSessionId = session.id;
      delete data.draftProjectId;
      return event;
    });
  }

  async steer(
    sessionId: string,
    input: AppendMessageRequest,
    skills: SkillReference[] = [],
    delivery: SteeringDelivery = "queue",
  ): Promise<ActivityEvent> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") throw new TypeError("This task is not currently running.");
      if (input.mode && input.mode !== session.mode) throw new TypeError("Wait for the current turn before changing task mode.");
      if (input.runtimeId && input.runtimeId !== session.runtimeId) throw new TypeError("Wait for the current turn before changing runtime.");
      const requestedModel = input.modelId === null ? undefined : input.modelId;
      if (input.modelId !== undefined && requestedModel !== session.modelId) throw new TypeError("Wait for the current turn before changing model.");
      if (delivery === "redirect") {
        for (const queued of data.events) {
          if (queued.sessionId === sessionId && queued.steering?.state === "queued") queued.steering.state = "superseded";
        }
      }
      const timestamp = new Date().toISOString();
      const event = this.userEvent(session, input.prompt, this.nextSequence(data, sessionId), timestamp, input.attachments, skills);
      event.steering = { delivery, state: "queued" };
      data.events.push(event);
      session.updatedAt = timestamp;
      this.refreshSteering(data, session);
      data.selectedSessionId = session.id;
      delete data.draftProjectId;
      return event;
    });
  }

  async startDraft(projectId: string): Promise<void> {
    await this.mutate((data) => {
      delete data.selectedSessionId;
      data.draftProjectId = projectId;
    });
  }

  async attachWorktree(sessionId: string, worktree: WorktreeSummary): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.worktree) throw new TypeError("This task already has an isolated worktree.");
      session.worktree = worktree;
      session.updatedAt = new Date().toISOString();
    });
  }

  async continueBuild(sessionId: string, worktree: WorktreeSummary): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      const previous = session.worktree;
      if (!previous) throw new TypeError("This task does not have a Build worktree to continue.");
      if (!["applied", "reverted", "archived", "cleaned"].includes(previous.status)) {
        throw new TypeError("Finish or recover the current Build worktree before continuing.");
      }
      session.worktreeHistory = [...(session.worktreeHistory ?? []), structuredClone(previous)];
      session.worktree = worktree;
      session.updatedAt = new Date().toISOString();
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Build continued",
        detail: `A fresh isolated worktree was created for the next edit. The previous checkpoint remains on ${previous.branch}.`,
        state: "complete",
        actor: "system",
      });
    });
  }

  async markWorktreeApplied(
    sessionId: string,
    checkpointCommit: string,
    changedFileCount: number,
    appliedPaths: string[] = [],
    appliedHunks: WorktreeHunkSelection[] = [],
  ): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (!session.worktree) throw new TypeError("This task does not have an isolated Build worktree.");
      if (session.worktree.status !== "applying") throw new TypeError("This Build was not waiting to be applied.");
      const appliedAt = new Date().toISOString();
      const combinedPaths = [...new Set([...(session.worktree.appliedPaths ?? []), ...appliedPaths])];
      const combinedHunks = { ...(session.worktree.appliedHunks ?? {}) };
      for (const selection of appliedHunks) {
        combinedHunks[selection.path] = [...new Set([...(combinedHunks[selection.path] ?? []), ...selection.hunkIds])];
      }
      const partial = (appliedPaths.length > 0 || appliedHunks.length > 0) && combinedPaths.length < changedFileCount;
      session.worktree.status = partial ? "active" : "applied";
      session.worktree.checkpointCommit = checkpointCommit;
      session.worktree.appliedPaths = combinedPaths;
      session.worktree.appliedHunks = combinedHunks;
      delete session.worktree.applyingPaths;
      delete session.worktree.applyingHunks;
      if (!partial) session.worktree.appliedAt = appliedAt;
      delete session.worktree.conflict;
      const selectedHunksByPath = new Map(appliedHunks.map((selection) => [selection.path, new Set(selection.hunkIds)]));
      const unresolvedConflicts = (session.worktree.conflicts ?? []).flatMap((conflict) => {
        if (combinedPaths.includes(conflict.path)) return [];
        const selected = selectedHunksByPath.get(conflict.path);
        if (!selected || !conflict.hunkIds?.length) return [conflict];
        const hunkIds = conflict.hunkIds.filter((id) => !selected.has(id));
        return hunkIds.length ? [{ ...conflict, hunkIds }] : [];
      });
      if (unresolvedConflicts.length) session.worktree.conflicts = unresolvedConflicts;
      else delete session.worktree.conflicts;
      session.updatedAt = appliedAt;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: partial ? "Selected changes applied" : "Changes applied",
        detail: partial
          ? `${appliedPaths.length || appliedHunks.length} selected ${appliedHunks.length ? "change groups were" : appliedPaths.length === 1 ? "file was" : "files were"} applied. ${changedFileCount - combinedPaths.length} files remain in the isolated Build.`
          : `${changedFileCount} ${changedFileCount === 1 ? "file was" : "files were"} applied to the approved project. The checkpoint remains on ${session.worktree.branch}.`,
        state: "complete",
        actor: "system",
      });
      return session;
    });
  }

  async markWorktreeApplying(
    sessionId: string,
    checkpointCommit: string,
    paths: string[] = [],
    hunks: WorktreeHunkSelection[] = [],
  ): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (!session.worktree) throw new TypeError("This task does not have an isolated Build worktree.");
      if (session.worktree.status !== "active" && session.worktree.status !== "conflicted") {
        throw new TypeError("These Build changes have already been finished.");
      }
      session.worktree.status = "applying";
      session.worktree.checkpointCommit = checkpointCommit;
      session.worktree.applyingPaths = paths;
      session.worktree.applyingHunks = hunks;
      delete session.worktree.conflict;
      session.updatedAt = new Date().toISOString();
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Applying changes",
        detail: `The checkpoint on ${session.worktree.branch} is being validated against the approved project.`,
        state: "running",
        actor: "system",
      });
      return session;
    });
  }

  async markWorktreeApplyFailed(
    sessionId: string,
    message: string,
    conflicts: WorktreeConflictSummary[] = [],
  ): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (!session.worktree) throw new TypeError("This task does not have an isolated Build worktree.");
      if (session.worktree.status === "applying") session.worktree.status = "conflicted";
      session.worktree.conflict = message;
      session.worktree.conflicts = conflicts;
      session.updatedAt = new Date().toISOString();
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Changes not applied",
        detail: message,
        state: "failed",
        actor: "system",
      });
      return session;
    });
  }

  async archiveWorktree(sessionId: string, checkpointCommit?: string): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      const worktree = session.worktree;
      if (!worktree) throw new TypeError("This task does not have an isolated Build worktree.");
      if (!["active", "conflicted", "applied", "reverted"].includes(worktree.status)) {
        throw new TypeError("This Build cannot be archived in its current state.");
      }
      const archivedAt = new Date().toISOString();
      worktree.archivedFrom = worktree.status as "active" | "conflicted" | "applied" | "reverted";
      worktree.status = "archived";
      worktree.archivedAt = archivedAt;
      if (checkpointCommit) worktree.checkpointCommit = checkpointCommit;
      session.updatedAt = archivedAt;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Build archived",
        detail: `The checkpoint and branch ${worktree.branch} remain available to restore.`,
        state: "complete",
        actor: "system",
      });
      return session;
    });
  }

  async restoreWorktree(sessionId: string, restoredPath: string): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      const worktree = session.worktree;
      if (!worktree || (worktree.status !== "archived" && worktree.status !== "cleaned")) {
        throw new TypeError("This Build is not archived or cleaned.");
      }
      const restoredAt = new Date().toISOString();
      worktree.path = restoredPath;
      worktree.status = worktree.archivedFrom ?? "active";
      delete worktree.cleanedAt;
      session.updatedAt = restoredAt;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Build restored",
        detail: `The isolated worktree on ${worktree.branch} is available again.`,
        state: "complete",
        actor: "system",
      });
      return session;
    });
  }

  async markWorktreeReverted(sessionId: string): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      const worktree = session.worktree;
      if (!worktree || worktree.status !== "applied") throw new TypeError("Only an applied Build can be reverted.");
      const revertedAt = new Date().toISOString();
      worktree.status = "reverted";
      worktree.revertedAt = revertedAt;
      session.updatedAt = revertedAt;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Build reverted",
        detail: "The checkpoint patch was removed from the approved project. The recovery branch remains available.",
        state: "complete",
        actor: "system",
      });
      return session;
    });
  }

  async markWorktreeCleaned(sessionId: string): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      const worktree = session.worktree;
      if (!worktree || worktree.status !== "archived") throw new TypeError("Archive this Build before cleanup.");
      const cleanedAt = new Date().toISOString();
      worktree.status = "cleaned";
      worktree.cleanedAt = cleanedAt;
      session.updatedAt = cleanedAt;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Worktree cleaned",
        detail: `The local worktree was removed. The ${worktree.branch} recovery branch remains available to restore.`,
        state: "complete",
        actor: "system",
      });
      return session;
    });
  }

  async markWorktreeStale(sessionId: string, message: string): Promise<SessionSummary> {
    return this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (!session.worktree) throw new TypeError("This task does not have an isolated Build worktree.");
      session.worktree.status = "stale";
      session.updatedAt = new Date().toISOString();
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Apply state needs review",
        detail: message,
        state: "failed",
        actor: "system",
      });
      return session;
    });
  }

  async begin(sessionId: string): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status === "running") throw new TypeError("This task is already running.");
      session.status = "running";
      session.updatedAt = new Date().toISOString();
      session.settlement = {
        state: "running",
        attempt: (session.settlement?.attempt ?? 0) + 1,
        startedAt: session.updatedAt,
        resumable: false,
      };
      data.selectedSessionId = session.id;
      delete data.draftProjectId;
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Agent started",
        detail: session.mode === "build"
          ? "Connecting to the selected runtime inside the isolated Build worktree."
          : "Connecting to the selected runtime with read-only project access.",
        state: "running",
        actor: "system",
      });
    });
  }

  async progress(sessionId: string, title: string, detail: string, state: "running" | "complete"): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") return;
      this.settleRunningProgress(data, session.id, "complete");
      this.pushEvent(data, session, { kind: "progress", title, detail, state, actor: "system" });
    });
  }

  async activity(
    sessionId: string,
    kind: "tool" | "approval",
    title: string,
    detail: string,
    state: "pending" | "running" | "complete" | "failed" | "denied",
  ): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") return;
      const existing = [...data.events].reverse().find((event) =>
        event.sessionId === session.id
        && event.kind === kind
        && event.title === title
        && (event.state === "pending" || event.state === "running"));
      if (existing && state !== "pending" && state !== "running") {
        existing.detail = detail;
        existing.state = state;
        existing.timestamp = new Date().toISOString();
      } else {
        this.pushEvent(data, session, { kind, title, detail, state, actor: "system" });
      }
      session.updatedAt = new Date().toISOString();
    });
  }

  async verification(sessionId: string, title: string, detail: string, state: "running" | "complete" | "failed" | "interrupted"): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      this.pushEvent(data, session, { kind: "verification", title, detail, state, actor: "system" });
      session.updatedAt = new Date().toISOString();
    });
  }

  async telemetry(sessionId: string, title: string, detail: string): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      this.pushEvent(data, session, { kind: "telemetry", title, detail, state: "complete", actor: "system" });
      session.updatedAt = new Date().toISOString();
    });
  }

  async lifecycle(sessionId: string, title: string, detail: string, state: "running" | "complete" | "failed" | "interrupted"): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      this.pushEvent(data, session, { kind: "lifecycle", title, detail, state, actor: "system" });
      session.updatedAt = new Date().toISOString();
    });
  }

  async complete(sessionId: string, answer: string, detail: string): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") return;
      this.settleOpenEvents(data, session.id, "complete");
      this.pushEvent(data, session, {
        kind: "message",
        title: answer,
        detail: "",
        state: "complete",
        actor: "agent",
      });
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Task complete",
        detail,
        state: "complete",
        actor: "system",
      });
      session.status = "idle";
      session.updatedAt = new Date().toISOString();
      session.settlement = {
        state: "complete",
        attempt: session.settlement?.attempt ?? 1,
        startedAt: session.settlement?.startedAt ?? session.updatedAt,
        settledAt: session.updatedAt,
        reason: detail,
        resumable: false,
      };
    });
  }

  async fail(sessionId: string, message: string): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") return;
      this.settleOpenEvents(data, session.id, "failed");
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title: "Agent could not finish",
        detail: message,
        state: "failed",
        actor: "system",
      });
      session.status = "failed";
      session.updatedAt = new Date().toISOString();
      session.settlement = {
        state: "failed",
        attempt: session.settlement?.attempt ?? 1,
        startedAt: session.settlement?.startedAt ?? session.updatedAt,
        settledAt: session.updatedAt,
        reason: message,
        resumable: true,
      };
    });
  }

  async interrupt(sessionId: string, reason = "Stopped by the user.", title = "Task stopped"): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      if (session.status !== "running") return;
      this.settleOpenEvents(data, session.id, "interrupted");
      this.pushEvent(data, session, {
        kind: "lifecycle",
        title,
        detail: reason,
        state: "interrupted",
        actor: "system",
      });
      session.status = "interrupted";
      session.updatedAt = new Date().toISOString();
      session.settlement = {
        state: "interrupted",
        attempt: session.settlement?.attempt ?? 1,
        startedAt: session.settlement?.startedAt ?? session.updatedAt,
        settledAt: session.updatedAt,
        reason,
        resumable: true,
      };
    });
  }

  async recoverInactive(activeSessionIds: ReadonlySet<string>): Promise<void> {
    await this.mutate((data) => {
      for (const session of data.sessions) {
        if (session.status !== "running" || activeSessionIds.has(session.id)) continue;
        this.settleOpenEvents(data, session.id, "interrupted");
        this.pushEvent(data, session, {
          kind: "lifecycle",
          title: "Task interrupted",
          detail: "Vraxis Code restarted before the agent finished. Resume when the runtime is ready.",
          state: "interrupted",
          actor: "system",
        });
        session.status = "interrupted";
        session.updatedAt = new Date().toISOString();
        session.settlement = {
          state: "recovery-needed",
          attempt: session.settlement?.attempt ?? 1,
          startedAt: session.settlement?.startedAt ?? session.updatedAt,
          settledAt: session.updatedAt,
          reason: "The app exited before the runtime returned a final result.",
          resumable: true,
        };
      }
    }, false);
  }

  async events(sessionId: string, after = 0): Promise<SessionEventsResponse> {
    const data = await this.read();
    const session = this.session(data, sessionId);
    return {
      session,
      events: data.events
        .filter((event) => event.sessionId === sessionId && event.sequence > after)
        .sort((left, right) => left.sequence - right.sequence),
    };
  }

  async get(sessionId: string): Promise<SessionSummary> {
    const data = await this.read();
    return this.session(data, sessionId);
  }

  async lastUserInput(sessionId: string): Promise<{ prompt: string; attachments: PromptAttachment[]; skillIds: string[] }> {
    const data = await this.read();
    this.session(data, sessionId);
    const event = data.events
      .filter((event) => event.sessionId === sessionId && event.kind === "message" && event.actor === "user")
      .at(-1);
    if (!event) throw new TypeError("This task has no message to resume.");
    return { prompt: event.title, attachments: event.attachments ?? [], skillIds: event.skills?.map((skill) => skill.id) ?? [] };
  }

  async nextSteeringInput(sessionId: string): Promise<PendingSteeringInput | undefined> {
    const data = await this.read();
    this.session(data, sessionId);
    const event = data.events
      .filter((item) => item.sessionId === sessionId && item.kind === "message" && item.actor === "user" && item.steering?.state === "queued")
      .sort((left, right) => left.sequence - right.sequence)[0];
    if (!event?.steering) return undefined;
    return {
      eventId: event.id,
      prompt: event.title,
      attachments: event.attachments ?? [],
      skillIds: event.skills?.map((skill) => skill.id) ?? [],
      delivery: event.steering.delivery,
    };
  }

  async markSteeringRunning(sessionId: string, eventId: string): Promise<void> {
    await this.updateSteeringEvent(sessionId, eventId, "running");
  }

  async markSteeringHandled(sessionId: string, eventId: string): Promise<void> {
    await this.updateSteeringEvent(sessionId, eventId, "handled");
  }

  async markSteeringSuperseded(sessionId: string, eventId: string): Promise<void> {
    await this.updateSteeringEvent(sessionId, eventId, "superseded");
  }

  async conversationBeforeLatestUser(
    sessionId: string,
    userEventId?: string,
  ): Promise<Array<{ actor: "user" | "agent"; text: string }>> {
    const data = await this.read();
    this.session(data, sessionId);
    const targetSequence = userEventId
      ? data.events.find((event) => event.id === userEventId && event.sessionId === sessionId)?.sequence
      : undefined;
    if (userEventId && targetSequence === undefined) throw new TypeError("Steering instruction was not found.");
    const messages = data.events
      .filter((event) => event.sessionId === sessionId
        && event.kind === "message"
        && (event.actor === "user" || event.actor === "agent")
        && (targetSequence === undefined || event.sequence < targetSequence)
        && event.steering?.state !== "queued")
      .map((event) => ({ actor: event.actor as "user" | "agent", text: event.title }));
    if (targetSequence === undefined && messages[messages.length - 1]?.actor === "user") messages.pop();
    return messages;
  }

  async select(sessionId: string): Promise<void> {
    await this.mutate((data) => {
      this.session(data, sessionId);
      data.selectedSessionId = sessionId;
      delete data.draftProjectId;
    });
  }

  private session(data: SessionData, sessionId: string): SessionSummary {
    const session = data.sessions.find((item) => item.id === sessionId);
    if (!session) throw new TypeError("Session was not found.");
    return session;
  }

  private nextSequence(data: SessionData, sessionId: string): number {
    return data.events.reduce((highest, event) => event.sessionId === sessionId ? Math.max(highest, event.sequence) : highest, 0) + 1;
  }

  private settleRunningProgress(
    data: SessionData,
    sessionId: string,
    state: "complete" | "failed" | "interrupted",
  ): void {
    for (let index = data.events.length - 1; index >= 0; index -= 1) {
      const event = data.events[index];
      if (event?.sessionId !== sessionId || event.kind !== "progress" || event.state !== "running") continue;
      event.state = state;
      return;
    }
  }

  private settleOpenEvents(
    data: SessionData,
    sessionId: string,
    state: "complete" | "failed" | "interrupted",
  ): void {
    for (const event of data.events) {
      if (event.sessionId !== sessionId || (event.state !== "running" && event.state !== "pending")) continue;
      event.state = state;
      event.timestamp = new Date().toISOString();
    }
  }

  private async updateSteeringEvent(
    sessionId: string,
    eventId: string,
    state: "running" | "handled" | "superseded",
  ): Promise<void> {
    await this.mutate((data) => {
      const session = this.session(data, sessionId);
      const event = data.events.find((item) => item.id === eventId && item.sessionId === sessionId);
      if (!event?.steering) throw new TypeError("Steering instruction was not found.");
      event.steering.state = state;
      session.updatedAt = new Date().toISOString();
      this.refreshSteering(data, session);
    });
  }

  private refreshSteering(data: SessionData, session: SessionSummary): void {
    const queued = data.events.filter((event) => event.sessionId === session.id && event.steering?.state === "queued");
    if (!queued.length) {
      delete session.steering;
      return;
    }
    session.steering = {
      state: queued.some((event) => event.steering?.delivery === "redirect") ? "redirecting" : "queued",
      pendingCount: queued.length,
      updatedAt: new Date().toISOString(),
    };
  }

  private pushEvent(
    data: SessionData,
    session: SessionSummary,
    event: Pick<ActivityEvent, "kind" | "title" | "detail" | "state" | "actor">,
  ): void {
    data.events.push({
      id: randomUUID(),
      sessionId: session.id,
      sequence: this.nextSequence(data, session.id),
      timestamp: new Date().toISOString(),
      runtimeId: session.runtimeId,
      ...event,
    });
  }

  private userEvent(
    session: SessionSummary,
    prompt: string,
    sequence: number,
    timestamp: string,
    attachments?: PromptAttachment[],
    skills: SkillReference[] = [],
  ): ActivityEvent {
    return {
      id: randomUUID(),
      sessionId: session.id,
      sequence,
      timestamp,
      runtimeId: session.runtimeId,
      kind: "message",
      title: prompt,
      detail: "",
      state: "complete",
      actor: "user",
      ...(attachments?.length ? { attachments } : {}),
      ...(skills.length ? { skills } : {}),
    };
  }

  private async readSnapshot(): Promise<SessionData> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as SessionData;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.events)) {
        throw new Error("Unsupported session registry.");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(emptyData);
      throw error;
    }
  }

  private async mutate<T>(change: (data: SessionData) => T, alwaysWrite = true): Promise<T> {
    let result!: T;
    const mutation = this.mutations.then(async () => {
      const data = await this.readSnapshot();
      const before = alwaysWrite ? "" : JSON.stringify(data);
      const previousSessions = new Map(data.sessions.map((session) => [session.id, JSON.stringify(session)]));
      const previousEvents = new Map(data.events.map((event) => [event.id, JSON.stringify(event)]));
      result = change(data);
      const changed = alwaysWrite || JSON.stringify(data) !== before;
      if (!changed) return;
      await this.write(data);
      const changedSessionIds = new Set<string>();
      for (const session of data.sessions) {
        if (previousSessions.get(session.id) !== JSON.stringify(session)) changedSessionIds.add(session.id);
      }
      for (const event of data.events) {
        if (previousEvents.get(event.id) !== JSON.stringify(event)) changedSessionIds.add(event.sessionId);
      }
      const notifications = [...changedSessionIds].flatMap((sessionId) => {
        const session = data.sessions.find((item) => item.id === sessionId);
        if (!session) return [];
        const events = data.events
          .filter((event) => event.sessionId === sessionId && previousEvents.get(event.id) !== JSON.stringify(event))
          .sort((left, right) => left.sequence - right.sequence);
        const cursor = data.events.reduce(
          (highest, event) => event.sessionId === sessionId ? Math.max(highest, event.sequence) : highest,
          0,
        );
        return [{ session: structuredClone(session), events: structuredClone(events), cursor }];
      });
      for (const update of notifications) {
        for (const listener of this.streamListeners.get(update.session.id) ?? []) {
          try { listener(update); } catch { /* A disconnected stream cannot fail persisted session state. */ }
        }
      }
    });
    this.mutations = mutation.catch(() => undefined);
    await mutation;
    return result;
  }

  private async write(data: SessionData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
