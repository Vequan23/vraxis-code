import type { TaskEvidenceKindV1, TaskProofEnvelopeV1, TaskReceiptV1, VerificationRunSummary } from "@vraxis/code-contracts";

function redactSensitiveText(value: string): string {
  return value
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{12,}\b/gi, "[REDACTED API KEY]")
    .replace(/\bAIza[a-z0-9_-]{20,}\b/gi, "[REDACTED API KEY]")
    .replace(/\bgh[pousr]_[a-z0-9]{20,}\b/gi, "[REDACTED TOKEN]")
    .replace(/\bxox[baprs]-[a-z0-9-]{12,}\b/gi, "[REDACTED TOKEN]")
    .replace(/\b(Bearer)\s+[a-z0-9._~+/=-]{12,}/gi, "$1 [REDACTED]")
    .replace(/((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD)\s*[=:]\s*)[^\s'";]+/gi, "$1[REDACTED]");
}

function escapeHtml(value: unknown): string {
  return redactSensitiveText(String(value ?? "")).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function time(value: string | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : escapeHtml(date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }));
}

function verificationVerdict(runs: VerificationRunSummary[]): { label: string; tone: string; detail: string } {
  const latest = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!latest) return { label: "Not verified", tone: "neutral", detail: "No retained verification run is attached to this task." };
  if (latest.state === "passed") return { label: "Verified", tone: "success", detail: "Every required service, project check, and browser proof passed." };
  if (latest.state === "failed") return { label: "Needs review", tone: "error", detail: "At least one required verification check or browser proof failed." };
  return { label: "Incomplete", tone: "warning", detail: `The latest verification run is ${latest.state.replace(/-/g, " ")}.` };
}

function list(items: string[], empty: string): string {
  return items.length ? `<ul>${items.join("")}</ul>` : `<p class="empty">${escapeHtml(empty)}</p>`;
}

function evidenceAnchor(proof: TaskProofEnvelopeV1 | undefined, kind: TaskEvidenceKindV1, target: string, content: string): string {
  const link = proof?.evidenceLinks?.find((item) => item.kind === kind && item.target === target);
  return link ? `<a class="evidence-link" href="${escapeHtml(link.deepLink)}">${content}</a>` : content;
}

export function renderTaskReceiptHtml(receipt: TaskReceiptV1, proof?: TaskProofEnvelopeV1): string {
  const verificationRuns = receipt.verificationRuns ?? [];
  const verdict = verificationVerdict(verificationRuns);
  const latestVerification = [...verificationRuns].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const completedApprovals = receipt.approvals.filter((item) => item.state === "completed").length;
  const successfulCommands = receipt.terminalRuns.filter((item) => item.status === "success").length;
  const browserActions = receipt.browser?.actions.length ?? 0;
  const browserErrors = (receipt.browser?.console.filter((item) => item.level === "error").length ?? 0)
    + (receipt.browser?.network.filter((item) => item.state === "error" || item.state === "blocked").length ?? 0);

  const changes = receipt.changes.map((change) => `<li><span>${evidenceAnchor(proof, "change", change.path, `<strong>${escapeHtml(change.path)}</strong>`)}<small>${escapeHtml(change.previousPath ? `${change.status} · from ${change.previousPath}` : change.status)}</small></span><span class="state">${escapeHtml(change.status)}</span></li>`);
  const services = (latestVerification?.services ?? []).map((service) => `<li><span><strong>${escapeHtml(service.title)}</strong><small>${escapeHtml(service.health.url)} · HTTP ${escapeHtml(service.lastHealthStatus ?? "not reached")} · ${escapeHtml(service.healthAttempts)} ${service.healthAttempts === 1 ? "attempt" : "attempts"}</small></span><span class="state ${escapeHtml(service.state)}">${escapeHtml(service.state.replace(/-/g, " "))}</span></li>`);
  const checks = (latestVerification?.checks ?? []).map((check) => `<li><span><strong>${escapeHtml(check.title)}</strong><small>${escapeHtml([check.command, ...check.args].join(" "))}</small></span><span class="state ${escapeHtml(check.state)}">${escapeHtml(check.state.replace(/-/g, " "))}</span></li>`);
  const browserAssertions = (latestVerification?.browserAssertions ?? []).map((assertion) => `<li><span><strong>${escapeHtml(assertion.title)}</strong><small>${escapeHtml(`${assertion.kind} ${assertion.match} “${assertion.value}”`)}${assertion.actual ? ` · saw ${escapeHtml(assertion.actual.slice(0, 180))}` : ""}</small></span><span class="state ${escapeHtml(assertion.state)}">${escapeHtml(assertion.state)}</span></li>`);
  const visual = latestVerification?.visual
    ? `<li><span><strong>${escapeHtml(latestVerification.visual.baselinePath)}</strong><small>${latestVerification.visual.diffRatio === undefined ? "Not compared" : `${escapeHtml(latestVerification.visual.diffPixels)} of ${escapeHtml(latestVerification.visual.totalPixels)} pixels differ · ${escapeHtml((latestVerification.visual.diffRatio * 100).toFixed(3))}% · tolerance ${escapeHtml((latestVerification.visual.maxDiffRatio * 100).toFixed(3))}%`}</small></span><span class="state ${escapeHtml(latestVerification.visual.state)}">${escapeHtml(latestVerification.visual.state)}</span></li>`
    : "";
  const recipe = latestVerification
    ? `<p class="recipe">Recipe <code>${escapeHtml(latestVerification.recipeFingerprint)}</code>${latestVerification.rerunOfId ? ` · rerun of <code>${escapeHtml(latestVerification.rerunOfId)}</code>` : ""}</p>`
    : "";
  const approvals = receipt.approvals.map((approval) => `<li><span>${evidenceAnchor(proof, "approval", approval.id, `<strong>${escapeHtml(approval.title)}</strong>`)}<small>${escapeHtml(approval.scope)}</small></span><span class="state ${escapeHtml(approval.state)}">${escapeHtml(approval.state)}</span></li>`);
  const commands = receipt.terminalRuns.map((run) => `<details><summary><span>${evidenceAnchor(proof, "terminal", run.id, `<strong>${escapeHtml(run.command)}</strong>`)}<small>${escapeHtml(run.cwd)} · ${escapeHtml(run.status)}${run.durationMs === undefined ? "" : ` · ${escapeHtml((run.durationMs / 1000).toFixed(1))}s`}</small></span></summary><pre>${escapeHtml(run.output || "No output was retained.")}</pre></details>`);
  const actions = (receipt.browser?.actions ?? []).map((action) => `<li><span>${evidenceAnchor(proof, "browser", action.id, `<strong>${escapeHtml(action.action)} · ${escapeHtml(action.target)}</strong>`)}<small>${time(action.timestamp)} · ${escapeHtml(action.actor ?? "unknown actor")}</small></span><span class="state ${escapeHtml(action.status)}">${escapeHtml(action.status)}</span></li>`);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Vraxis Code task receipt v${receipt.version}">
<title>${escapeHtml(receipt.project.name)} · ${escapeHtml(receipt.session.title)} · Vraxis proof</title>
<style>
:root{color-scheme:dark;--bg:#101112;--panel:#191b1d;--raised:#202326;--line:#34383c;--text:#f0f1f2;--muted:#a3a8ad;--success:#68bc82;--warning:#d7a04b;--error:#df7772;--accent:#78b6d8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(960px,calc(100% - 32px));margin:0 auto;padding:48px 0 72px}header{display:grid;gap:12px;margin-bottom:24px}h1,h2,p{margin:0}h1{font-size:28px;line-height:1.2;letter-spacing:-.02em}h2{font-size:14px}a{color:var(--accent)}.evidence-link{color:inherit;text-decoration-color:var(--accent);text-decoration-thickness:1px;text-underline-offset:3px}.evidence-link:hover{color:var(--accent)}.eyebrow{color:var(--muted);font-size:12px;font-weight:700;letter-spacing:.11em;text-transform:uppercase}.verdict{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.verdict>div{display:grid;gap:3px}.verdict strong{font-size:18px}.verdict small,.meta small,li small,summary small,.empty{color:var(--muted)}.pill,.state{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px 9px;font-size:12px;text-transform:capitalize}.pill.success,.state.passed,.state.completed,.state.success{border-color:color-mix(in srgb,var(--success) 55%,var(--line));color:var(--success)}.pill.warning,.state.running,.state.awaiting-approval,.state.pending,.state.interrupted{color:var(--warning)}.pill.error,.state.failed,.state.error,.state.denied{color:var(--error)}.meta,.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:var(--line)}.meta>div,.metrics>div{min-width:0;display:grid;gap:2px;padding:12px;background:var(--panel)}.meta strong,.metrics strong{overflow-wrap:anywhere}.metrics strong{font-size:21px}.metrics small{color:var(--muted)}section{display:grid;gap:10px;margin-top:22px}.card{padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.recipe{margin-bottom:10px;color:var(--muted);font-size:12px;overflow-wrap:anywhere}.recipe code{color:var(--text)}ul{display:grid;gap:1px;margin:0;padding:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;list-style:none}li{min-height:52px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 11px;background:var(--raised)}li>span:first-child,summary span{min-width:0;display:grid;gap:2px}li strong,li small{overflow-wrap:anywhere}code,pre{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}details{border:1px solid var(--line);border-radius:9px;background:var(--raised);overflow:hidden}details+details{margin-top:6px}summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;cursor:pointer}pre{max-height:360px;margin:0;padding:12px;overflow:auto;border-top:1px solid var(--line);background:#111314;white-space:pre-wrap;overflow-wrap:anywhere}.proof-integrity{display:grid;gap:8px}.proof-integrity p{overflow-wrap:anywhere}.provenance{color:var(--muted);font-size:12px}.provenance code{color:var(--text)}@media(max-width:700px){main{width:min(100% - 20px,960px);padding-top:24px}.meta,.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.verdict{align-items:flex-start;flex-direction:column}}@media print{:root{color-scheme:light;--bg:#fff;--panel:#fff;--raised:#fff;--line:#c8c8c8;--text:#111;--muted:#555}main{width:100%;padding:0}details{break-inside:avoid}details>pre{display:block}}
</style>
</head>
<body>
<main>
<header><span class="eyebrow">Vraxis verified task receipt</span><h1>${escapeHtml(receipt.session.title)}</h1><p>${escapeHtml(receipt.project.name)} · ${escapeHtml(receipt.project.branch)} · generated ${time(receipt.generatedAt)}</p></header>
<section class="verdict"><div><span class="eyebrow">Result</span><strong>${escapeHtml(verdict.label)}</strong><small>${escapeHtml(verdict.detail)}</small></div><span class="pill ${escapeHtml(verdict.tone)}">${escapeHtml(verdict.label)}</span></section>
<section class="meta" aria-label="Task identity"><div><small>Mode</small><strong>${escapeHtml(receipt.session.mode)}</strong></div><div><small>Runtime</small><strong>${escapeHtml(receipt.session.runtimeId)}</strong></div><div><small>Model</small><strong>${escapeHtml(receipt.session.modelId ?? "Runtime default")}</strong></div><div><small>Task status</small><strong>${escapeHtml(receipt.session.status)}</strong></div></section>
<section class="metrics" aria-label="Evidence summary"><div><strong>${receipt.changes.length}</strong><small>changed files</small></div><div><strong>${successfulCommands}/${receipt.terminalRuns.length}</strong><small>commands passed</small></div><div><strong>${completedApprovals}/${receipt.approvals.length}</strong><small>approvals completed</small></div><div><strong>${browserActions}</strong><small>browser actions · ${browserErrors} errors</small></div></section>
<section><h2>Verification services</h2><div class="card">${recipe}${list(services, "No governed services are attached to this task.")}</div></section>
<section><h2>Verification checks</h2><div class="card">${list(checks, "No verification commands are attached to this task.")}</div></section>
<section><h2>Browser assertions</h2><div class="card">${list(browserAssertions, "No browser acceptance assertions are attached to this task.")}</div></section>
<section><h2>Visual comparison</h2><div class="card">${visual ? `<ul>${visual}</ul>` : '<p class="empty">No visual baseline is attached to this task.</p>'}</div></section>
<section><h2>Changes</h2><div class="card">${list(changes, "No changed files are attached to this task.")}</div></section>
<section><h2>Authority</h2><div class="card">${list(approvals, "No capability approvals were requested.")}</div></section>
<section><h2>Terminal evidence</h2><div class="card">${commands.join("") || '<p class="empty">No terminal receipts are attached.</p>'}</div></section>
<section><h2>Browser evidence</h2><div class="card">${list(actions, "No browser actions are attached to this task.")}</div></section>
${proof ? `<section><h2>Proof integrity</h2><div class="card proof-integrity"><p><strong>Signed locally with Ed25519</strong> · <a href="${escapeHtml(proof.deepLink)}">Open this task in Vraxis Code</a></p><p>Artifact <code>${escapeHtml(proof.artifactId)}</code></p><p>Signing key <code>${escapeHtml(proof.integrity.keyId)}</code></p><p>Signature <code>${escapeHtml(proof.integrity.signature)}</code></p><p class="empty">Verify the companion JSON envelope using <code>${escapeHtml(proof.integrity.canonicalization)}</code>. The private signing key never leaves this Vraxis Code installation.</p></div></section>` : ""}
<section class="provenance"><p>Receipt <code>${escapeHtml(receipt.session.id)}</code> · schema <code>${escapeHtml(receipt.kind)}@${receipt.version}</code> · updated ${time(receipt.session.updatedAt)}</p><p>This offline document is a human-readable projection. Common credential patterns are redacted, but review command output before sharing. The JSON receipt remains the canonical machine contract.</p></section>
</main>
</body>
</html>`;
}
