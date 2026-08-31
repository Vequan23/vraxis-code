import type {
  ProjectDoctorSummary,
  ProjectSummary,
  RuntimeSummary,
  SessionSummary,
  VerificationRunSummary,
} from "@vraxis/code-contracts";

export type FirstRunActionId =
  | "setup-runtime"
  | "verify-runtime"
  | "choose-project"
  | "inspect-project"
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
  if (!runtime || runtime.availability !== "installed" || runtime.authentication === "required") return false;
  return runtime.kind === "hosted-provider" || runtime.conformance?.state === "ready";
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
  const runtimeCanProbe = Boolean(input.runtime
    && input.runtime.availability === "installed"
    && input.runtime.authentication !== "required"
    && input.runtime.kind !== "hosted-provider");
  const projectIsReady = Boolean(input.project && input.projectDoctor?.ok);
  const task = input.sessions[0];
  const taskIsReady = Boolean(task);
  const taskIsRunning = task?.status === "running";
  const proofIsReady = input.verificationRuns.some((run) => run.state === "passed");
  const recipeIsReady = verificationRecipeReady(input.projectDoctor);

  const steps: FirstRunStep[] = [
    {
      id: "runtime",
      label: "Verify an agent harness",
      detail: runtimeIsReady
        ? `${input.runtime?.name ?? "Runtime"} is ready for governed work.`
        : runtimeCanProbe
          ? `${input.runtime?.name ?? "Runtime"} is installed. Run one bounded live conformance check.`
          : input.runtime?.authentication === "required"
            ? `${input.runtime.name} needs authentication before it can run.`
            : "Install or connect a supported coding harness.",
      state: runtimeIsReady ? "complete" : "current",
    },
    {
      id: "project",
      label: "Inspect a project",
      detail: projectIsReady
        ? `${input.project?.name ?? "Project"} has a manifest-backed readiness report.`
        : input.project && input.projectDoctor
          ? "Project Doctor found issues that need attention before verification."
          : input.project
            ? "Inspect manifests and verification commands without executing project code."
            : "Choose the local repository you want Vraxis Code to understand.",
      state: projectIsReady ? "complete" : runtimeIsReady ? (input.projectDoctor ? "attention" : "current") : "pending",
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
      label: "Verify and export proof",
      detail: proofIsReady
        ? "Required checks passed. Portable signed proof is ready to export."
        : taskIsRunning
          ? "Verification becomes available when the current agent turn finishes."
          : recipeIsReady
            ? "Run the project-owned checks and retain terminal and browser evidence."
            : "Review Project Doctor and add a bounded verification recipe when needed.",
      state: proofIsReady ? "complete" : taskIsReady ? (recipeIsReady ? "current" : "attention") : "pending",
    },
  ];

  let action: FirstRunReadiness["action"];
  if (!runtimeIsReady) {
    action = runtimeCanProbe
      ? { id: "verify-runtime", label: `Verify ${input.runtime?.name ?? "runtime"}`, detail: "One bounded request; no project or tool authority." }
      : { id: "setup-runtime", label: "Set up a harness", detail: "Install, authenticate, update, or connect a provider." };
  } else if (!input.project) {
    action = { id: "choose-project", label: "Choose project", detail: "Only the folder you approve is indexed." };
  } else if (!projectIsReady) {
    action = { id: "inspect-project", label: "Run Project Doctor", detail: "Manifest inspection does not execute project code." };
  } else if (!taskIsReady) {
    action = { id: "draft-task", label: "Draft the first task", detail: "Start with a read-only, file-backed architecture question." };
  } else if (!proofIsReady) {
    action = {
      id: "review-verification",
      label: taskIsRunning ? "View live evidence" : recipeIsReady ? "Review and run checks" : "Review verification setup",
      detail: taskIsRunning ? "Follow the current turn without interrupting it." : "Inspect the exact commands and browser assertions before they run.",
    };
  } else {
    action = { id: "export-proof", label: "Export signed proof", detail: "Portable JSON verifies without trusting this installation." };
  }

  return {
    steps,
    completed: steps.filter((step) => step.state === "complete").length,
    action,
    complete: proofIsReady,
  };
}
