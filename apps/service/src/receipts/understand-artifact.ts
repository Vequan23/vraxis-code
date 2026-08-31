import type {
  TaskProofEnvelopeV1,
  UnderstandArtifactEnvelopeV1,
  UnderstandArtifactPayloadV1,
  UnderstandEvidenceKindV1,
  UnderstandEvidenceLinkV1,
  VerificationRunSummary,
} from "@vraxis/code-contracts";
import { canonicalJsonBytes } from "./canonical-json.js";
import { TaskProofSigner, verifySignedPayload } from "./task-proof.js";

function taskDeepLink(sessionId: string): string {
  return `vraxis-code://task/${encodeURIComponent(sessionId)}`;
}

function evidenceLink(
  sessionId: string,
  id: string,
  kind: UnderstandEvidenceKindV1,
  target: string,
  label: string,
): UnderstandEvidenceLinkV1 {
  const query = new URLSearchParams({ evidence: kind, target });
  return { id, kind, target, label, deepLink: `${taskDeepLink(sessionId)}?${query.toString()}` };
}

function successfulVerification(run: VerificationRunSummary): boolean {
  return run.state === "passed"
    && run.checks.filter((check) => check.required).every((check) => check.state === "passed")
    && run.browserState !== "failed"
    && run.visual?.state !== "failed";
}

export function understandPayload(proof: TaskProofEnvelopeV1): UnderstandArtifactPayloadV1 {
  const receipt = proof.receipt;
  const sessionId = receipt.session.id;
  const passedRuns = (receipt.verificationRuns ?? []).filter(successfulVerification);
  const failedRuns = (receipt.verificationRuns ?? []).filter((run) => run.state === "failed" || run.state === "interrupted");
  const failedTerminals = receipt.terminalRuns.filter((run) => run.status === "error" || run.status === "interrupted");
  const failedBrowserActions = receipt.browser?.actions.filter((action) => action.status === "error") ?? [];
  const browserErrors = receipt.browser?.console.filter((entry) => entry.level === "error") ?? [];
  const networkErrors = receipt.browser?.network.filter((entry) => entry.state === "error" || entry.state === "blocked") ?? [];

  const evidenceLinks: UnderstandEvidenceLinkV1[] = [
    ...receipt.changes.map((change, index) => evidenceLink(sessionId, `change-${index + 1}`, "change", change.path, change.path)),
    ...(receipt.verificationRuns ?? []).map((run, index) => evidenceLink(
      sessionId,
      `verification-${index + 1}`,
      "verification",
      run.id,
      `Verification ${run.id.slice(0, 8)} · ${run.state}`,
    )),
    ...receipt.approvals.map((approval, index) => evidenceLink(
      sessionId,
      `approval-${index + 1}`,
      "approval",
      approval.id,
      `${approval.capability} decision · ${approval.state}`,
    )),
    ...receipt.terminalRuns.map((run, index) => evidenceLink(
      sessionId,
      `terminal-${index + 1}`,
      "terminal",
      run.id,
      `Terminal run ${index + 1} · ${run.status}`,
    )),
    ...(receipt.browser?.actions ?? []).map((action, index) => evidenceLink(
      sessionId,
      `browser-${index + 1}`,
      "browser",
      action.id,
      `Browser action ${index + 1} · ${action.action} · ${action.status}`,
    )),
    ...(receipt.worktree ? [evidenceLink(sessionId, "worktree-1", "worktree", receipt.worktree.id, `Worktree · ${receipt.worktree.status}`)] : []),
  ];
  const linkId = (kind: UnderstandEvidenceKindV1, target: string): string | undefined =>
    evidenceLinks.find((link) => link.kind === kind && link.target === target)?.id;

  const changes = receipt.changes.map((change) => {
    const coveringRuns = passedRuns.filter((run) => run.changedPaths.includes(change.path));
    return {
      ...change,
      coverage: coveringRuns.length ? "verified" as const : "unverified" as const,
      verificationIds: coveringRuns.map((run) => run.id),
    };
  });
  const unverified = changes.filter((change) => change.coverage === "unverified");
  const adverseEvidence = failedRuns.length + failedTerminals.length + failedBrowserActions.length + browserErrors.length + networkErrors.length;
  const conflicted = receipt.worktree?.status === "conflicted";
  const verdictState = adverseEvidence || conflicted
    ? "needs-review" as const
    : changes.length === 0 || unverified.length === 0
      ? "verified" as const
      : passedRuns.length
        ? "partially-verified" as const
        : "unverified" as const;
  const verdictSummary = conflicted
    ? "The retained worktree is conflicted and needs review before delivery."
    : adverseEvidence
      ? `${adverseEvidence} retained failure ${adverseEvidence === 1 ? "signal needs" : "signals need"} review.`
      : changes.length === 0
        ? "This task retained no workspace changes; its evidence describes an answer-only run."
        : unverified.length === 0
          ? `All ${changes.length} changed ${changes.length === 1 ? "path is" : "paths are"} covered by passed governed verification.`
          : passedRuns.length
            ? `${changes.length - unverified.length} of ${changes.length} changed paths are covered by passed governed verification.`
            : `None of the ${changes.length} changed ${changes.length === 1 ? "path is" : "paths are"} covered by passed governed verification.`;

  const claims: UnderstandArtifactPayloadV1["claims"] = [];
  if (changes.length === 0) {
    claims.push({ id: "claim-no-changes", statement: "No workspace changes are retained for this task.", evidenceIds: [] });
  } else {
    claims.push({
      id: "claim-change-map",
      statement: `${changes.length} changed ${changes.length === 1 ? "path is" : "paths are"} retained in the task receipt.`,
      evidenceIds: changes.map((change) => linkId("change", change.path)).filter((id): id is string => Boolean(id)),
    });
  }
  if (passedRuns.length) {
    claims.push({
      id: "claim-verification",
      statement: `${passedRuns.length} governed verification ${passedRuns.length === 1 ? "run has" : "runs have"} passed.`,
      evidenceIds: passedRuns.map((run) => linkId("verification", run.id)).filter((id): id is string => Boolean(id)),
    });
  }
  const completedApprovals = receipt.approvals.filter((approval) => approval.state === "completed");
  if (completedApprovals.length) {
    claims.push({
      id: "claim-approvals",
      statement: `${completedApprovals.length} governed capability ${completedApprovals.length === 1 ? "decision is" : "decisions are"} retained.`,
      evidenceIds: completedApprovals.map((approval) => linkId("approval", approval.id)).filter((id): id is string => Boolean(id)),
    });
  }
  const successfulBrowserActions = receipt.browser?.actions.filter((action) => action.status === "success") ?? [];
  if (successfulBrowserActions.length) {
    claims.push({
      id: "claim-browser",
      statement: `${successfulBrowserActions.length} controlled browser ${successfulBrowserActions.length === 1 ? "action is" : "actions are"} retained.`,
      evidenceIds: successfulBrowserActions.map((action) => linkId("browser", action.id)).filter((id): id is string => Boolean(id)),
    });
  }

  const risks: UnderstandArtifactPayloadV1["risks"] = [];
  if (conflicted) risks.push({ id: "risk-conflict", severity: "critical", title: "Worktree conflict", detail: "The isolated worktree is conflicted and cannot be treated as ready to deliver.", evidenceIds: ["worktree-1"] });
  if (failedRuns.length) risks.push({ id: "risk-verification", severity: "critical", title: "Verification did not pass", detail: `${failedRuns.length} retained verification ${failedRuns.length === 1 ? "run failed or was interrupted" : "runs failed or were interrupted"}.`, evidenceIds: failedRuns.map((run) => linkId("verification", run.id)).filter((id): id is string => Boolean(id)) });
  if (failedTerminals.length) risks.push({ id: "risk-terminal", severity: "critical", title: "Command failure retained", detail: `${failedTerminals.length} governed terminal ${failedTerminals.length === 1 ? "run failed or was interrupted" : "runs failed or were interrupted"}.`, evidenceIds: failedTerminals.map((run) => linkId("terminal", run.id)).filter((id): id is string => Boolean(id)) });
  if (failedBrowserActions.length || browserErrors.length || networkErrors.length) risks.push({ id: "risk-browser", severity: "critical", title: "Browser failure retained", detail: `${failedBrowserActions.length + browserErrors.length + networkErrors.length} browser, console, or network failure ${failedBrowserActions.length + browserErrors.length + networkErrors.length === 1 ? "signal is" : "signals are"} retained.`, evidenceIds: failedBrowserActions.map((action) => linkId("browser", action.id)).filter((id): id is string => Boolean(id)) });
  if (unverified.length) risks.push({ id: "risk-coverage", severity: "warning", title: "Incomplete changed-path coverage", detail: `${unverified.length} changed ${unverified.length === 1 ? "path is" : "paths are"} not covered by a passed governed verification run.`, evidenceIds: unverified.map((change) => linkId("change", change.path)).filter((id): id is string => Boolean(id)) });
  if (!risks.length) risks.push({ id: "risk-none-retained", severity: "info", title: "No contradictory evidence retained", detail: "The retained evidence contains no failed verification, terminal, browser, network, or worktree-conflict signal. This is not a guarantee beyond the captured evidence.", evidenceIds: passedRuns.map((run) => linkId("verification", run.id)).filter((id): id is string => Boolean(id)) });

  const teachBack: UnderstandArtifactPayloadV1["teachBack"] = [];
  if (changes[0]) teachBack.push({ id: "teach-change", question: `What behavior depends on ${changes[0].path}, and how did this task change it?`, evidenceIds: [linkId("change", changes[0].path)].filter((id): id is string => Boolean(id)) });
  if (passedRuns[0]) teachBack.push({ id: "teach-proof", question: "Which retained checks support the delivery verdict, and what did each check actually cover?", evidenceIds: [linkId("verification", passedRuns[0].id)].filter((id): id is string => Boolean(id)) });
  if (receipt.worktree) teachBack.push({ id: "teach-rollback", question: "How would you return this task to its recorded base without discarding unrelated work?", evidenceIds: ["worktree-1"] });
  if (!teachBack.length) teachBack.push({ id: "teach-answer", question: "Which retained evidence supports the answer, and which assumptions still need direct inspection?", evidenceIds: [] });

  return {
    kind: "vraxis.understand-artifact",
    version: 1,
    generatedAt: proof.generatedAt,
    deepLink: taskDeepLink(sessionId),
    sourceProof: { artifactId: proof.artifactId, keyId: proof.integrity.keyId },
    session: {
      id: receipt.session.id,
      title: receipt.session.title,
      mode: receipt.session.mode,
      runtimeId: receipt.session.runtimeId,
      ...(receipt.session.modelId ? { modelId: receipt.session.modelId } : {}),
    },
    project: receipt.project,
    verdict: { state: verdictState, summary: verdictSummary },
    changes,
    claims,
    risks,
    ...(receipt.worktree ? { rollback: {
      summary: `Return ${receipt.worktree.branch} to ${receipt.worktree.baseBranch} at ${receipt.worktree.baseCommit.slice(0, 12)} using the governed worktree lifecycle.`,
      branch: receipt.worktree.branch,
      baseBranch: receipt.worktree.baseBranch,
      baseCommit: receipt.worktree.baseCommit,
      ...(receipt.worktree.checkpointCommit ? { checkpointCommit: receipt.worktree.checkpointCommit } : {}),
      evidenceIds: ["worktree-1"],
    } } : {}),
    teachBack,
    evidenceLinks,
  };
}

export async function createUnderstandArtifact(
  proof: TaskProofEnvelopeV1,
  signer: TaskProofSigner,
): Promise<UnderstandArtifactEnvelopeV1> {
  const payload = understandPayload(proof);
  return { ...payload, ...(await signer.signArtifact(payload)) };
}

export function verifyUnderstandArtifact(artifact: UnderstandArtifactEnvelopeV1): boolean {
  try {
    if (artifact.kind !== "vraxis.understand-artifact" || artifact.version !== 1) return false;
    if (artifact.deepLink !== taskDeepLink(artifact.session.id)) return false;
    const { artifactId, integrity, ...payload } = artifact;
    return verifySignedPayload(canonicalJsonBytes(payload), artifactId, integrity);
  } catch {
    return false;
  }
}
