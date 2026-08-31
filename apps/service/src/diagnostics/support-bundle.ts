import { arch, platform } from "node:os";
import type {
  ApprovalSummary,
  ProjectSummary,
  RuntimeSummary,
  SessionSummary,
  SupportBundleV1,
  TerminalRunSummary,
  VerificationRunSummary,
  StartupRecoverySummary,
} from "@vraxis/code-contracts";

export interface SupportBundleInput {
  applicationVersion: string;
  contractVersion: number;
  desktopSessionProtected: boolean;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  runtimes: RuntimeSummary[];
  approvals: ApprovalSummary[];
  terminalRuns: TerminalRunSummary[];
  verificationRuns: VerificationRunSummary[];
  startupRecovery?: StartupRecoverySummary;
}

function sessionCounts(sessions: SessionSummary[]): Record<SessionSummary["status"], number> {
  const result: Record<SessionSummary["status"], number> = {
    idle: 0,
    running: 0,
    failed: 0,
    interrupted: 0,
  };
  for (const session of sessions) result[session.status] += 1;
  return result;
}

export function createSupportBundle(input: SupportBundleInput): SupportBundleV1 {
  return {
    kind: "vraxis.support-bundle",
    version: 1,
    generatedAt: new Date().toISOString(),
    application: {
      name: "Vraxis Code",
      version: input.applicationVersion,
      contractVersion: input.contractVersion,
    },
    environment: {
      platform: platform(),
      architecture: arch(),
      node: process.versions.node,
      desktop: input.desktopSessionProtected,
    },
    inventory: {
      projects: {
        total: input.projects.length,
        ready: input.projects.filter((item) => item.status === "ready").length,
        unavailable: input.projects.filter((item) => item.status !== "ready").length,
      },
      sessions: sessionCounts(input.sessions),
      runtimes: input.runtimes.map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        availability: runtime.availability,
        ...(runtime.version ? { version: runtime.version } : {}),
        ...(runtime.authentication ? { authentication: runtime.authentication } : {}),
        ...(runtime.update ? { updateStatus: runtime.update.status } : {}),
        ...(runtime.conformance ? { conformance: runtime.conformance.state } : {}),
      })),
    },
    recovery: {
      previousUnexpectedExit: input.startupRecovery?.previousUnexpectedExit ?? false,
      approvalsInterrupted: input.approvals.filter((item) => item.state === "interrupted").length,
      terminalRunsInterrupted: input.terminalRuns.filter((item) => item.status === "interrupted").length,
      verificationsInterrupted: input.verificationRuns.filter((item) => item.state === "interrupted").length,
      worktreesNeedingReview: input.sessions.filter((item) => item.worktree && ["conflicted", "missing", "stale", "applying"].includes(item.worktree.status)).length,
    },
    security: {
      loopbackOnly: true,
      desktopSessionProtected: input.desktopSessionProtected,
      rendererNodeAccess: false,
      includesProjectContent: false,
      includesCredentials: false,
    },
  };
}
