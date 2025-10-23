// content.js — send question context + auto-stop at post block

let lastQ = null;
let lastPid = null;
let isStopped = false; // prevent any further sends after stop

function stopTrackingNow(reason) {
  if (isStopped) return;
  isStopped = true;
  chrome.runtime.sendMessage({ type: "STOP_BY_SURVEY", reason });
  console.log("[tracker/content] STOP_BY_SURVEY", reason || "");
}

function readFromMarker() {
  const m = document.getElementById('qtrack');
  return {
    q: m?.dataset?.q?.trim() || null,
    pid: m?.dataset?.pid?.trim() || null,
    phase: m?.dataset?.phase?.trim() || null
  };
}

function maybeSend(q, pid) {
  if (isStopped) return;
  if (!q || q === lastQ) return;
  lastQ = q;
  if (pid) lastPid = pid;
  chrome.runtime.sendMessage({ type: "CONTEXT_UPDATE", questionId: q, pid: lastPid || undefined });
  console.log("[tracker/content] CONTEXT_UPDATE:", q, lastPid || "");
}

// --- 1) postMessage: question updates + explicit post-phase ---
window.addEventListener("message", (e) => {
  const d = e?.data;
  if (!d || d.__qtrack__ !== true) return;

  // A) Stop signal from the post block
  if (d.phase === 'post') {
    stopTrackingNow("phase=post (post-question block)");
    return;
  }

  // B) Normal question context
  const qid = (d.qid || '').trim();
  const pid = (d.pid || '').trim() || null;
  if (qid) {
    maybeSend(qid, pid);
  }
}, false);

// --- 2) Observe #qtrack updates (q/pid + phase) ---
const marker = document.getElementById("qtrack");
if (marker) {
  new MutationObserver(() => {
    const { q, pid, phase } = readFromMarker();

    if (phase === 'post') {
      stopTrackingNow("marker phase=post");
      return;
    }
    if (q) {
      maybeSend(q, pid);
    }
  }).observe(marker, { attributes: true, attributeFilter: ["data-q", "data-pid", "data-phase"] });
}

// --- 3) Initial read (in case marker is already present) ---
const init = readFromMarker();
if (init.phase === 'post') {
  stopTrackingNow("marker phase=post (initial)");
} else if (init.q) {
  maybeSend(init.q, init.pid);
}

console.log("[tracker/content] loaded on", location.href);
