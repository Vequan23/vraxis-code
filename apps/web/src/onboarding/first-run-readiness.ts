import type {
  ProjectDoctorSummary,
  ProjectSummary,
  RuntimeSummary,
  SessionSummary,
  VerificationRunSummary,
} from "@vraxis/code-contracts";
import { runtimeCanProbe, runtimeIsReady } from "../settings/runtime-conformance.js";

export type FirstRunActionId =
  | "setup-runtime"
  | "connect-provider"
  | "verify-runtime"
  | "choose-project"
  | "create-project"
  | "draft-task"
  | "review-verification"
  | "export-proof";

export interface FirstRunStep {
  id: "runtime" | "project" | "task" | "proof";
  label: string;
  detail: string;
  state: "complete" | "current" | "pending" | "attention";
}

export interface FirstRunReadiness {
  steps: FirstRunStep[];
  completed: number;
  action: { id: FirstRunActionId; label: string; detail: string };
  complete: boolean;
}

export interface FirstRunReadinessInput {
  runtime?: RuntimeSummary;
  project?: ProjectSummary;
  projectDoctor?: ProjectDoctorSummary;
  sessions: SessionSummary[];
  verificationRuns: VerificationRunSummary[];
}

function runtimeReady(runtime?: RuntimeSummary): boolean {
  return runtimeIsReady(runtime);
}

function verificationRecipeReady(doctor?: ProjectDoctorSummary): boolean {
  return Boolean(doctor && (
    doctor.verificationChecks.length
    || doctor.verificationServices?.length
    || doctor.verificationSource?.browserRequired
  ));
}

export function firstRunReadiness(input: FirstRunReadinessInput): FirstRunReadiness {
  const runtimeIsReady = runtimeReady(input.runtime);
  const runtimeCanProbeNow = runtimeCanProbe(input.runtime);
  const projectIsReady = Boolean(input.project);
  const task = input.sessions[0];
  const taskIsReady = Boolean(task);
  const taskIsRunning = task?.status === "running";
  const proofIsReady = input.verificationRuns.some((run) => run.state === "passed");
  const recipeIsReady = verificationRecipeReady(input.projectDoctor);

  const steps: FirstRunStep[] = [
    {
      id: "runtime",
      label: "Connect a runtime",
      detail: runtimeIsReady
        ? `${input.runtime?.name ?? "Runtime"} is ready for governed work.`
        : runtimeCanProbeNow
          ? input.runtime?.kind === "hosted-provider"
            ? `${input.runtime?.name ?? "Provider"} is connected. Run Test connection to verify credentials and model access.`
            : `${input.runtime?.name ?? "Runtime"} is installed. Run one bounded live conformance check.`
          : input.runtime?.authentication === "required"
            ? `${input.runtime.name} needs authentication before it can run.`
            : "Install an agent harness or connect a direct model provider.",
      state: runtimeIsReady ? "complete" : "current",
    },
    {
      id: "project",
      label: "Create or open a project",
      detail: projectIsReady
        ? `${input.project?.name ?? "Project"} is ready for governed work.`
        : "Create a new repository or open an existing local folder.",
      state: projectIsReady ? "complete" : runtimeIsReady ? "current" : "pending",
    },
    {
      id: "task",
      label: "Run the first task",
      detail: taskIsReady
        ? taskIsRunning ? "The agent is working inside the selected authority boundary." : `“${task?.title}” is retained with its runtime and evidence.`
        : "Start with a file-backed architecture question, then continue into Build when ready.",
      state: taskIsReady ? "complete" : runtimeIsReady && projectIsReady ? "current" : "pending",
    },
    {
      id: "proof",
      label: "Run checks and export proof",
      detail: proofIsReady
        ? "Required checks passed. Portable signed proof is ready to export."
        : taskIsRunning
          ? "Checks become available when the current agent turn finishes."
          : recipeIsReady
            ? "Run the project checks and retain terminal and browser evidence."
            : "Add test or lint scripts, or create .vraxis/verify.json when you need reproducible delivery proof.",
      state: proofIsReady ? "complete" : taskIsReady ? (recipeIsReady ? "current" : "attention") : "pending",
    },
  ];

  let action: FirstRunReadiness["action"];
  if (!runtimeIsReady) {
    action = runtimeCanProbeNow
      ? { id: "verify-runtime", label: `Verify ${input.runtime?.name ?? "runtime"}`, detail: "One bounded request; no project or tool authority." }
      : { id: "setup-runtime", label: "Set up a runtime", detail: "Install an agent harness or connect a direct API provider." };
  } else if (!input.project) {
    action = { id: "choose-project", label: "Open existing project", detail: "Only the folder you approve is indexed." };
  } else if (!taskIsReady) {
    action = { id: "draft-task", label: "Draft the first task", detail: "Start with a read-only, file-backed architecture question." };
  } else if (!proofIsReady) {
    action = {
      id: "review-verification",
      label: taskIsRunning ? "View live evidence" : recipeIsReady ? "Run checks" : "Open checks",
      detail: taskIsRunning ? "Follow the current turn without interrupting it." : recipeIsReady ? "Approve and run the checks this project declares." : "See what checks are available for this project.",
    };
  } else {
    action = { id: "export-proof", label: "Export proof", detail: "Download a shareable HTML report after checks passed." };
  }

  return {
    steps,
    completed: steps.filter((step) => step.state === "complete").length,
    action,
    complete: proofIsReady,
  };
}
