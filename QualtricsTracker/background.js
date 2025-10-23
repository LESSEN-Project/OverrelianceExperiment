console.log("[tracker] background loaded");

// ====== CONFIG ======
const COLLECTOR_URL = "https://ayden-uncondensed-kristen.ngrok-free.dev/ingest";
const REMOTE_CONFIG_URL = null;

const FOCUS_THROTTLE_MS = 2000;      // don't spam if user flicks tabs quickly
const lastFocusByTab = new Map();  

// ====== CONSTANTS ======
const QUALTRICS_HOST_REGEX = /(^|\.)qualtrics\.(com|eu)$/i;
const BATCH_SIZE = 1;
const FLUSH_INTERVAL_MS = 3000;
const ALLOWED_TRANSITIONS = [
  "link", "generated", "form_submit", "auto_bookmark",
  "typed", "keyword", "keyword_generated", "reload"
];

// ====== HELPERS (define BEFORE use) ======
function isQualtrics(u) {
  try { return QUALTRICS_HOST_REGEX.test(new URL(u).hostname); }
  catch { return false; }
}
function isHttpLike(u) {
  try {
    const p = new URL(u).protocol;
    return p === "http:" || p === "https:";
  } catch { return false; }
}

// tiny de-dupe to avoid double log on first nav (new_tab -> immediate commit/redirect)
const DEDUPE_TTL_MS = 2500;
const recentNavs = new Map(); // `${tabId}|${url}` -> timestamp
function markDedup(tabId, url) {
  const key = `${tabId}|${normalizeUrl(url)}`;
  recentNavs.set(key, Date.now());
}
function isDup(tabId, url) {
  const key = `${tabId}|${normalizeUrl(url)}`;
  const t = recentNavs.get(key);
  if (!t) return false;
  const dup = (Date.now() - t) <= DEDUPE_TTL_MS;
  if (!dup) recentNavs.delete(key);
  return dup;
}

function enqueue(entry) {
  console.log("[tracker] enqueue", entry);
  queue.push(entry);
  if (queue.length >= BATCH_SIZE) flush();
}
async function flush() {
  if (!collectorUrl || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  console.log("[tracker] flushing", batch.length, "events to", collectorUrl);
  try {
    const resp = await fetch(collectorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch })
    });
    console.log("[tracker] upload status", resp.status);
  } catch (e) {
    console.warn("[tracker] upload failed", e);
    queue.unshift(...batch);
  }
}
setInterval(flush, FLUSH_INTERVAL_MS);

// ====== STATE ======
let trackingActive = false;
let prolificId = null;
let collectorUrl = COLLECTOR_URL;
let queue = [];
const createdTabs = new Set(); // tabs just created via onCreatedNavigationTarget
let lastQuestionSeenAt = 0;              // ms epoch of last CONTEXT_UPDATE
const ATTRIBUTE_WINDOW_MS = 10 * 60 * 1000; // 10 min “between questions” window

// last seen question id from any Qualtrics page
let activeQuestionId = null;

// which tabs are currently on a Qualtrics page
const qualtricsTabs = new Set(); // Set<tabId>

// external tabId -> stamped questionId
const tabQuestion = new Map(); // Map<tabId, questionId>

// ====== INIT / SETTINGS ======
async function loadSettings() {
  const { trackingActive: ta, currentProlificId: pid } = await chrome.storage.local.get([
    "trackingActive", "currentProlificId"
  ]);
  trackingActive = !!ta;
  prolificId = pid || null;

  if (REMOTE_CONFIG_URL) {
    try {
      const resp = await fetch(REMOTE_CONFIG_URL, { cache: "no-store" });
      if (resp.ok) {
        const cfg = await resp.json();
        if (cfg && typeof cfg.collectorUrl === "string" && /^https?:\/\//i.test(cfg.collectorUrl)) {
          collectorUrl = cfg.collectorUrl;
          console.log("Collector URL overridden by remote config:", collectorUrl);
        }
      }
    } catch (e) {
      console.warn("Remote config fetch failed; using hardcoded collector URL.", e);
    }
  }
}
loadSettings();

function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hostname = x.hostname.replace(/^www\./i, ""); // strip www.
    x.hash = "";                                    // ignore fragments
    return x.toString();
  } catch { return u; }
}

function handleTopFrameNav(details, sourceLabel) {
  if (!trackingActive || !prolificId) return;

  const { tabId, url, transitionType, frameId } = details;

  // Only top frame + http(s) + not Qualtrics
  if (frameId !== 0) return;
  if (!url || !isHttpLike(url)) return;
  if (isQualtrics(url)) return;

  // For onHistoryStateUpdated, transitionType may be undefined; that's fine
  if (transitionType && !ALLOWED_TRANSITIONS.includes(transitionType)) return;

  // Must have seen a question (Qx) this session
  if (!activeQuestionId) return;

  // If this tab was just created and we logged its first nav already, skip the first commit
  if (createdTabs.has(tabId)) {
    createdTabs.delete(tabId);
    return;
  }

  // Drop exact-recent duplicates (commit + history, quick redirects, etc.)
  if (isDup(tabId, url)) return;

  // Determine question id for this tab
  let q = tabQuestion.get(tabId);

  // If this was a Qualtrics tab navigating out (same-tab case), stamp now
  if (!q && qualtricsTabs.has(tabId)) {
    q = activeQuestionId;
    tabQuestion.set(tabId, q);
    qualtricsTabs.delete(tabId);
  }

  // ✅ Key change: if this is an already-open, un-stamped tab,
  // stamp it to the *current* question on its FIRST observed navigation.
  if (!q) {
    q = activeQuestionId;
    tabQuestion.set(tabId, q);
  }

  // If somehow still no q (shouldn't happen), bail
  if (!q) return;

  // Log it
  enqueue({
    ts: new Date().toISOString(),
    url,
    questionId: q,
    prolificId,
    source: sourceLabel // "same_tab" for both committed + SPA updates
  });

  // Mark dedupe so a same-URL history/commit pair doesn't double-log
  markDedup(tabId, url);
}


chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  handleTopFrameNav(details, "same_tab");
});

// ====== MESSAGES FROM POPUP / CONTENT ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (msg?.type === "START_TRACKING") {
    trackingActive = true;
    prolificId = msg.prolificId || prolificId;
    chrome.storage.local.set({ trackingActive: true, currentProlificId: prolificId, __stoppedBySurvey: false, __stoppedReason: null, __stoppedAt: null });
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "STOP_TRACKING") {
    trackingActive = false;
    chrome.storage.local.set({ trackingActive: false });
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "STOP_BY_SURVEY") {
    trackingActive = false;

    qualtricsTabs.clear();
    tabQuestion.clear();

    const stopped = {
      trackingActive: false,
      __stoppedBySurvey: true,
      __stoppedReason: msg.reason || "survey complete",
      __stoppedAt: new Date().toISOString()
    };
    chrome.storage.local.set(stopped);

    flush();
    console.log("[tracker] STOP_BY_SURVEY:", msg.reason || "");
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "CONTEXT_UPDATE" && tabId != null) {
    // mark this as a Qualtrics tab
    qualtricsTabs.add(tabId);

    // adopt ResponseID (pid) from Qualtrics & auto-start
    if (msg.pid) {
      prolificId = msg.pid;
      trackingActive = true; // auto-start on first context
      chrome.storage.local.set({ currentProlificId: prolificId, trackingActive: true, __stoppedBySurvey: false, __stoppedReason: null, __stoppedAt: null });
    }

    const q = msg.questionId || null;
    if (q && q !== activeQuestionId) {
    activeQuestionId = q;
    lastQuestionSeenAt = Date.now();
    chrome.storage.local.set({ __activeQuestionId: activeQuestionId });
    lastFocusByTab.clear();  // <-- reset focus throttle on question change
    console.log("[tracker] activeQuestionId ->", activeQuestionId, "pid:", prolificId || "");
    }

    sendResponse?.({ ok: true });
    return true;
  }
});

// ====== TAB LIFECYCLE ======
chrome.tabs.onRemoved.addListener((tabId) => {
  qualtricsTabs.delete(tabId);
  tabQuestion.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && tab?.url) {
    try {
      const h = new URL(tab.url).hostname;
      if (QUALTRICS_HOST_REGEX.test(h)) {
        qualtricsTabs.add(tabId);
      } else {
        qualtricsTabs.delete(tabId);
      }
    } catch {}
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const t = await chrome.tabs.get(tabId);
    if (!t || !t.url) return;

    const url = t.url;
    if (!trackingActive || !activeQuestionId || !prolificId) return;
    if (!isHttpLike(url)) return;
    if (isQualtrics(url)) return;

    // Throttle: if same tab focusing same URL very recently, skip
    const norm = normalizeUrl(url);
    const prev = lastFocusByTab.get(tabId);
    const now = Date.now();
    if (prev && prev.url === norm && (now - prev.ts) < FOCUS_THROTTLE_MS) return;
    lastFocusByTab.set(tabId, { url: norm, ts: now });

    // IMPORTANT: Do NOT stamp tabQuestion here.
    // We want tab_focus to always reflect the *current* question.
    // (Navigation attribution continues to use your existing stamping logic.)

    enqueue({
      ts: new Date().toISOString(),
      url,
      questionId: activeQuestionId,  // <-- always current Q for tab_focus
      prolificId,
      source: "tab_focus"
    });

  } catch (e) {
    console.warn("[tracker] onActivated error", e);
  }
});

// ====== NAVIGATION CAPTURE ======

// 1) New tab opened (Ctrl/⌘-click, window.open, context menu)
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  if (!trackingActive || !prolificId) return;

  const { sourceTabId, tabId, url } = details;
  if (!url || !isHttpLike(url)) return;
  if (isQualtrics(url)) return;
  if (!activeQuestionId) return; // don’t log before any question is seen

  // Determine question to stamp:
  const inheritedQ = tabQuestion.get(sourceTabId);
  const q = inheritedQ || (qualtricsTabs.has(sourceTabId) ? activeQuestionId : null);
  if (!q) return;

  // Stamp new external tab
  tabQuestion.set(tabId, q);

  // Log initial nav
  enqueue({
    ts: new Date().toISOString(),
    url,
    questionId: q,
    prolificId,
    source: "new_tab"
  });

  // prevent duplicate when onCommitted fires right after creation (redirect/canon)
  createdTabs.add(tabId);
  // also mark dedupe by URL (harmless safety)
  markDedup(tabId, url);
});

// 2) Same-tab out of Qualtrics + subsequent hops in external tabs
chrome.webNavigation.onCommitted.addListener(details => {
    handleTopFrameNav(details, "same_tab");
});

// 3) Stamp tabs created from ANY opener (covers cases onCreatedNavigationTarget misses)
chrome.tabs.onCreated.addListener((tab) => {
  const openerId = tab.openerTabId;
  if (!openerId) return;

  // If the opener was an external stamped tab, inherit its question.
  const inheritedQ = tabQuestion.get(openerId);
  if (inheritedQ) {
    tabQuestion.set(tab.id, inheritedQ);
    return;
  }

  // If the opener is a Qualtrics tab, use current active question.
  if (qualtricsTabs.has(openerId) && activeQuestionId) {
    tabQuestion.set(tab.id, activeQuestionId);
  }
});
