// content.js — send question context and stop only when the survey explicitly ends

let lastQ = null;
let lastrid = null;
let isStopped = false; // prevent any further sends after stop

const STOP_PHASES = new Set([
  "complete",
  "completed",
  "done",
  "finished",
  "final",
  "post",
  "survey_end",
  "end",
  "end_of_survey"
]);

const STOP_FLAG_KEYS = [
  "stop",
  "shouldStop",
  "surveyComplete",
  "complete",
  "completed",
  "finished",
  "done",
  "final",
  "isFinal",
  "experimentComplete"
];

function truthyFlag(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }
  return false;
}

function normalizePhase(phase) {
  if (typeof phase !== "string") return "";
  return phase.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function detectStopReason(source, payload) {
  if (!payload) return null;

  for (const key of STOP_FLAG_KEYS) {
    if (truthyFlag(payload[key])) {
      return `${source} flag ${key}`;
    }
  }

  const normPhase = normalizePhase(payload.phase);
  if (normPhase && STOP_PHASES.has(normPhase)) {
    return `${source} phase=${normPhase}`;
  }

  if (payload.type === "STOP_BY_SURVEY") {
    return `${source} explicit STOP_BY_SURVEY`;
  }

  return null;
}

function stopTrackingNow(reason) {
  if (isStopped) return;
  isStopped = true;
  chrome.runtime.sendMessage({ type: "STOP_BY_SURVEY", reason });
  console.log("[tracker/content] STOP_BY_SURVEY", reason || "");
}

function readFromMarker() {
  const m = document.getElementById("qtrack");
  return {
    q: m?.dataset?.q?.trim() || null,
    rid: m?.dataset?.rid?.trim() || null,
    pid: m?.dataset?.pid?.trim() || null,
    phase: m?.dataset?.phase?.trim() || null
  };
}

function maybeSendContext({ questionId, rid, pid }) {
  if (isStopped) return;
  const q = typeof questionId === "string" && questionId.trim() ? questionId.trim() : null;
  const ridCandidate = typeof rid === "string" && rid.trim() ? rid.trim() : null;
  const pidCandidate = typeof pid === "string" && pid.trim() ? pid.trim() : null;
  const nextRid = ridCandidate || pidCandidate || null;
  const effectiveQ = q || lastQ;

  const questionChanged = Boolean(effectiveQ && effectiveQ !== lastQ);
  const ridChanged = Boolean(nextRid && nextRid !== lastrid);

  if (!questionChanged && !ridChanged) return;

  if (questionChanged) {
    lastQ = effectiveQ;
  }
  if (nextRid) {
    lastrid = nextRid;
  }

  chrome.runtime.sendMessage({
    type: "CONTEXT_UPDATE",
    questionId: lastQ || undefined,
    rid: lastrid || undefined
  });
  console.log("[tracker/content] CONTEXT_UPDATE:", lastQ || "(none)", lastrid || "");
}

// --- 1) postMessage: question updates + explicit post-phase ---
window.addEventListener("message", (e) => {
  const d = e?.data;
  if (!d || d.__qtrack__ !== true) return;

  const qid = (d.qid || "").trim();
  const rid = (d.rid || "").trim() || null;
  const pid = (d.pid || "").trim() || null;

  const stopReason = detectStopReason("postMessage", d);
  if (stopReason) {
    if (qid || rid || pid) {
      maybeSendContext({ questionId: qid || null, rid, pid });
    }
    stopTrackingNow(stopReason);
    return;
  }

  if (qid || rid || pid) {
    maybeSendContext({ questionId: qid || null, rid, pid });
  }
}, false);

// --- 2) Observe #qtrack updates (q/rid + phase) ---
const marker = document.getElementById("qtrack");
if (marker) {
  new MutationObserver(() => {
    const { q, rid, pid, phase } = readFromMarker();
    const payload = { ...marker.dataset, phase };
    const stopReason = detectStopReason("marker", payload);

    if (stopReason) {
      if (q || rid || pid) {
        maybeSendContext({ questionId: q, rid, pid });
      }
      stopTrackingNow(stopReason);
      return;
    }
    if (q || rid || pid) {
      maybeSendContext({ questionId: q, rid, pid });
    }
  }).observe(marker, {
    attributes: true,
    attributeFilter: [
      "data-q",
      "data-rid",
      "data-pid",
      "data-phase",
      "data-stop",
      "data-complete",
      "data-completed",
      "data-finished",
      "data-done",
      "data-final",
      "data-survey-complete",
      "data-surveycomplete"
    ]
  });
}

// --- 3) Initial read (in case marker is already present) ---
const init = readFromMarker();
const initialPayload = marker ? { ...marker.dataset, phase: init.phase } : { phase: init.phase };
const initStopReason = detectStopReason("marker(init)", initialPayload);
if (initStopReason) {
  if (init.q || init.rid || init.pid) {
    maybeSendContext({ questionId: init.q, rid: init.rid, pid: init.pid });
  }
  stopTrackingNow(initStopReason);
} else if (init.q || init.rid || init.pid) {
  maybeSendContext({ questionId: init.q, rid: init.rid, pid: init.pid });
}

function setupEndOfSurveyObserver() {
  const END_SELECTOR = "#EndOfSurvey, .EndOfSurvey, [data-end-of-survey]";

  const check = (origin) => {
    if (isStopped) return true;
    const node = document.querySelector(END_SELECTOR);
    if (!node) return false;
    stopTrackingNow(`end_of_survey (${origin})`);
    return true;
  };

  const attach = () => {
    if (!document.body) {
      window.requestAnimationFrame(attach);
      return;
    }
    if (check("initial")) return;
    const observer = new MutationObserver(() => {
      if (check("mutation")) {
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
}

setupEndOfSurveyObserver();

console.log("[tracker/content] loaded on", location.href);
