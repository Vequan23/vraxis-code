import { randomBytes } from "node:crypto";
import type { BrowserActionFrameSummary, BrowserActionSummary, BrowserSessionSummary } from "@vraxis/code-contracts";
import { redactPortableText } from "../receipts/portable-redaction.js";

export interface BrowserReplayDocument {
  html: string;
  contentSecurityPolicy: string;
  frameCount: number;
  actionCount: number;
}

interface ReplayFrame {
  id: string;
  actionId: string;
  phase: BrowserActionFrameSummary["phase"];
  timestamp: string;
  url: string;
  title: string;
  action: BrowserActionSummary["action"];
  target: string;
  detail: string;
  actor: "user" | "agent" | "unknown";
  status: BrowserActionSummary["status"];
  approvalId?: string;
  image: string;
}

function escapeHtml(value: unknown): string {
  return redactPortableText(String(value ?? "")).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Builds a network-inert, self-contained visual record from retained browser action frames. */
export async function renderBrowserReplay(
  state: BrowserSessionSummary,
  frameContent: (frameId: string) => Promise<Buffer>,
): Promise<BrowserReplayDocument> {
  const actions = new Map(state.actions.map((action) => [action.id, action]));
  const orderedFrames = [...(state.frames ?? [])]
    .filter((frame) => actions.has(frame.actionId))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const frames = (await Promise.all(orderedFrames.map(async (frame): Promise<ReplayFrame | undefined> => {
    const action = actions.get(frame.actionId);
    if (!action) return undefined;
    try {
      const image = (await frameContent(frame.id)).toString("base64");
      return {
        id: frame.id,
        actionId: frame.actionId,
        phase: frame.phase,
        timestamp: frame.timestamp,
        url: redactPortableText(frame.url),
        title: redactPortableText(frame.title),
        action: action.action,
        target: redactPortableText(action.target),
        detail: redactPortableText(action.detail),
        actor: action.actor ?? "unknown",
        status: action.status,
        ...(action.approvalId ? { approvalId: action.approvalId } : {}),
        image: `data:image/png;base64,${image}`,
      };
    } catch {
      return undefined;
    }
  }))).filter((frame): frame is ReplayFrame => Boolean(frame));
  if (!frames.length) throw new TypeError("This browser task does not have retained action frames to export.");

  const nonce = randomBytes(18).toString("base64url");
  const contentSecurityPolicy = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const metaContentSecurityPolicy = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'`;
  const actionCount = new Set(frames.map((frame) => frame.actionId)).size;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Vraxis Code browser evidence replay v1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(metaContentSecurityPolicy)}">
<title>${escapeHtml(state.title || "Browser evidence")} · Vraxis replay</title>
<style>
:root{color-scheme:dark;--bg:#0d0f10;--panel:#171a1c;--raised:#202428;--line:#343a3f;--text:#f1f3f4;--muted:#9ca4aa;--accent:#67b5df;--success:#69bd83;--error:#df7772}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input{font:inherit}main{min-height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr)}header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:18px 22px;border-bottom:1px solid var(--line);background:var(--panel)}h1,p{margin:0}h1{font-size:18px}.eyebrow{color:var(--accent);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.summary{display:grid;gap:3px}.summary p,.privacy{color:var(--muted);font-size:12px}.privacy{max-width:420px;text-align:right}.workspace{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 320px}.stage{min-width:0;display:grid;grid-template-rows:minmax(0,1fr) auto;padding:20px}.viewport{min-height:0;display:grid;place-items:center;overflow:hidden;border:1px solid var(--line);border-radius:12px;background:#060707}.viewport img{width:100%;height:100%;object-fit:contain}.transport{display:grid;grid-template-columns:auto minmax(180px,1fr) auto;align-items:center;gap:14px;padding-top:14px}.buttons{display:flex;gap:7px}.buttons button{min-width:70px;padding:7px 11px;border:1px solid var(--line);border-radius:8px;color:var(--text);background:var(--raised);cursor:pointer}.buttons button:hover{border-color:var(--accent)}.buttons button:focus-visible,.timeline button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.position{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px}.position input{width:100%;accent-color:var(--accent)}.position output{min-width:54px;color:var(--muted);font-variant-numeric:tabular-nums;text-align:right}.speed{display:flex;align-items:center;gap:7px;color:var(--muted);font-size:12px}.speed select{padding:5px;border:1px solid var(--line);border-radius:7px;color:var(--text);background:var(--raised)}aside{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);border-left:1px solid var(--line);background:var(--panel)}.current{display:grid;gap:8px;padding:17px;border-bottom:1px solid var(--line)}.current-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.current strong{text-transform:capitalize}.pill{padding:2px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px;text-transform:capitalize}.pill.success{color:var(--success)}.pill.error{color:var(--error)}.current dl{display:grid;grid-template-columns:64px minmax(0,1fr);gap:5px 9px;margin:0;font-size:12px}.current dt{color:var(--muted)}.current dd{margin:0;overflow-wrap:anywhere}.timeline{min-height:0;overflow:auto;margin:0;padding:8px;list-style:none}.timeline button{width:100%;display:grid;grid-template-columns:35px minmax(0,1fr);gap:9px;padding:9px;border:1px solid transparent;border-radius:8px;color:var(--text);background:transparent;text-align:left;cursor:pointer}.timeline button:hover{background:var(--raised)}.timeline button[aria-current=true]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}.timeline code{color:var(--accent);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}.timeline span{min-width:0;display:grid;gap:1px}.timeline strong,.timeline small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.timeline strong{font-size:12px;text-transform:capitalize}.timeline small{color:var(--muted);font-size:11px}@media(max-width:860px){.workspace{grid-template-columns:1fr;grid-template-rows:minmax(420px,65vh) auto}aside{border-top:1px solid var(--line);border-left:0}.privacy{display:none}.timeline{max-height:300px}.stage{padding:12px}}
</style>
</head>
<body>
<main>
<header><div class="summary"><span class="eyebrow">Portable browser evidence</span><h1>${escapeHtml(state.title || state.url || "Browser task")}</h1><p>${actionCount} actions · ${frames.length} retained frames · exported ${escapeHtml(new Date().toISOString())}</p></div><p class="privacy">Screenshots can contain private page data. This file is offline and network-inert; review it before sharing.</p></header>
<div class="workspace">
<section class="stage" aria-label="Browser replay player"><div class="viewport"><img id="frame" alt="Browser action frame"></div><div class="transport"><div class="buttons"><button id="previous" type="button">Previous</button><button id="play" type="button">Play</button><button id="next" type="button">Next</button></div><label class="position"><span class="eyebrow">Timeline</span><input id="position" type="range" min="0" max="${frames.length - 1}" value="0"><output id="counter">1 / ${frames.length}</output></label><label class="speed">Speed <select id="speed"><option value="2200">0.5×</option><option value="1400" selected>1×</option><option value="800">2×</option></select></label></div></section>
<aside><section class="current" aria-live="polite"><div class="current-row"><strong id="action"></strong><span id="status" class="pill"></span></div><dl><dt>Phase</dt><dd id="phase"></dd><dt>Actor</dt><dd id="actor"></dd><dt>Target</dt><dd id="target"></dd><dt>Page</dt><dd id="page"></dd><dt>Time</dt><dd id="time"></dd><dt>Approval</dt><dd id="approval"></dd></dl></section><ol id="timeline" class="timeline" aria-label="Browser action frames"></ol></aside>
</div>
</main>
<script id="replay-data" type="application/json">${safeJson(frames)}</script>
<script nonce="${nonce}">
const frames=JSON.parse(document.getElementById("replay-data").textContent);let index=0,timer;const byId=(id)=>document.getElementById(id);const image=byId("frame"),position=byId("position"),play=byId("play"),timeline=byId("timeline");
function stop(){if(timer)clearInterval(timer);timer=undefined;play.textContent="Play"}
function show(next){index=Math.max(0,Math.min(frames.length-1,next));const frame=frames[index];image.src=frame.image;image.alt=frame.phase+" frame for "+frame.action+" on "+frame.title;byId("action").textContent=frame.action;byId("status").textContent=frame.status;byId("status").className="pill "+frame.status;byId("phase").textContent=frame.phase;byId("actor").textContent=frame.actor;byId("target").textContent=frame.target;byId("page").textContent=frame.title+" · "+frame.url;byId("time").textContent=new Date(frame.timestamp).toLocaleString();byId("approval").textContent=frame.approvalId||"No approval receipt";position.value=String(index);byId("counter").textContent=(index+1)+" / "+frames.length;timeline.querySelectorAll("button").forEach((button,item)=>button.setAttribute("aria-current",String(item===index)));timeline.children[index]?.scrollIntoView({block:"nearest"})}
frames.forEach((frame,item)=>{const li=document.createElement("li"),button=document.createElement("button"),count=document.createElement("code"),copy=document.createElement("span"),title=document.createElement("strong"),detail=document.createElement("small");button.type="button";button.addEventListener("click",()=>{stop();show(item)});count.textContent=String(item+1).padStart(2,"0");title.textContent=frame.action+" · "+frame.phase;detail.textContent=frame.actor+" · "+frame.target;copy.append(title,detail);button.append(count,copy);li.append(button);timeline.append(li)});
byId("previous").addEventListener("click",()=>{stop();show(index-1)});byId("next").addEventListener("click",()=>{stop();show(index+1)});position.addEventListener("input",()=>{stop();show(Number(position.value))});play.addEventListener("click",()=>{if(timer){stop();return}play.textContent="Pause";timer=setInterval(()=>{if(index>=frames.length-1){stop();return}show(index+1)},Number(byId("speed").value))});byId("speed").addEventListener("change",()=>{if(timer){stop();play.click()}});show(0);
</script>
</body>
</html>`;
  return { html, contentSecurityPolicy, frameCount: frames.length, actionCount };
}
