console.log("[tracker] background loaded");

// ====== CONFIG ======
const COLLECTOR_URL = "https://ayden-uncondensed-kristen.ngrok-free.dev/ingest";
const REMOTE_CONFIG_URL = null;

const FOCUS_THROTTLE_MS = 2000;      // don't spam if user flicks tabs quickly
const lastFocusByTab = new Map();  

// ====== CONSTANTS ======
const QUALTRICS_HOST_REGEX = /(^|\.)qualtrics\.(com|eu)$/i;
const QUALTRICS_URL_PATTERNS = [
  "*://*.qualtrics.com/*",
  "*://*.qualtrics.com/*/*",
  "*://*.qualtrics.eu/*",
  "*://*.qualtrics.eu/*/*",
  "*://*.eu.qualtrics.com/*/*",
  "*://leidenuniv.eu.qualtrics.com/*/*"
];
const BATCH_SIZE = 1;
const FLUSH_INTERVAL_MS = 3000;
const LOG_STATE_KEY = "__qtrack_log_state";
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

const SEARCH_ENGINES = [
  { name: "google", host: /(^|\.)google\.[a-z.]+$/i, queryParam: "q", path: /^\/search/i },
  { name: "bing", host: /(^|\.)bing\.com$/i, queryParam: "q", path: /^\/(search|images\/search)/i },
  { name: "duckduckgo", host: /(^|\.)duckduckgo\.com$/i, queryParam: "q" },
  { name: "yahoo", host: /(^|\.)search\.yahoo\.com$/i, queryParam: "p", path: /^\/search/i }
];
const AI_PLACEHOLDER_PHRASES = [
  "something went wrong",
  "try again",
  "history wasn't deleted",
  "still working on it",
  "generating your answer",
  "loading your answer"
];

function isSearchResultsUrl(u) {
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return SEARCH_ENGINES.some(({ host, queryParam, path }) => {
      if (!host.test(parsed.hostname)) return false;
      if (path && !path.test(parsed.pathname)) return false;
      if (queryParam && !parsed.searchParams.get(queryParam)) return false;
      return true;
    });
  } catch {
    return false;
  }
}

function isGoogleAiMode(url) {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/i.test(parsed.hostname)) return false;
    return parsed.searchParams.get("udm") === "50";
  } catch {
    return false;
  }
}

function canonicalizeUrlObject(url) {
  url.hostname = url.hostname.replace(/^www\./i, "");
  url.hash = "";

  const GOOGLE_HOST_RE = /(^|\.)google\.[a-z.]+$/i;
  if (GOOGLE_HOST_RE.test(url.hostname) && url.pathname === "/search") {
    const allowedParams = new Set([
      "q",
      "udm",
      "ia",
      "tbm",
      "tbs",
      "hl",
      "gl",
      "oq"
    ]);
    const entries = [];
    for (const [key, value] of url.searchParams) {
      if (allowedParams.has(key)) {
        entries.push([key, value]);
      }
    }
    entries.sort((a, b) => {
      if (a[0] === b[0]) return a[1].localeCompare(b[1]);
      return a[0].localeCompare(b[0]);
    });
    const next = new URLSearchParams();
    for (const [key, value] of entries) next.append(key, value);
    url.search = next.toString() ? `?${next.toString()}` : "";
  }

  return url;
}

function canonicalizeUrlForLogging(u) {
  try {
    const url = new URL(u);
    return canonicalizeUrlObject(url).toString();
  } catch {
    return null;
  }
}

function isAiPlaceholderSummary(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AI_PLACEHOLDER_PHRASES.some((phrase) => lower.includes(phrase));
}

async function maybeExtractSearchResults(tabId, url) {
  if (tabId == null || !isSearchResultsUrl(url)) return null;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_INJECTION_ATTEMPTS = 5;
  const INJECTION_DELAY_MS = 500;
  const isAiMode = isGoogleAiMode(url);

  for (let attempt = 0; attempt < MAX_INJECTION_ATTEMPTS; attempt++) {
    try {
      const injection = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func: (maxResults, options) => {
          const isAiMode = options?.googleAiMode === true;
          const MAX_AI_TEXT_LENGTH = 2000;

          const MAX_ATTEMPTS = 10;
          const ATTEMPT_DELAY_MS = 200;

          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          const normalizeCandidate = (rawHref, depth = 0) => {
            if (!rawHref || depth > 3) return null;
            let href = rawHref.trim();
            if (!href) return null;
            try {
              if (href.startsWith("javascript:") || href.startsWith("mailto:")) return null;
              if (href.startsWith("//")) {
                href = `${location.protocol}${href}`;
              } else if (href.startsWith("/")) {
                href = new URL(href, location.origin).href;
              } else if (!/^https?:/i.test(href)) {
                href = new URL(href, location.href).href;
              }

              const candidate = new URL(href);

              // Handle Google redirect wrapper links (/url?...)
              if (
                candidate.hostname === location.hostname &&
                candidate.pathname === "/url"
              ) {
                const redirected =
                  candidate.searchParams.get("url") ||
                  candidate.searchParams.get("q");
                if (redirected) {
                  return normalizeCandidate(redirected, depth + 1);
                }
                return null;
              }

              if (candidate.hostname === location.hostname) {
                const internalPath = candidate.pathname || "";
                if (/^\/(search|preferences|settings)/i.test(internalPath)) return null;
                if (internalPath === "/" && candidate.searchParams?.has("q")) return null;
              }

              if (!/^https?:$/i.test(candidate.protocol)) return null;
              return candidate.href;
            } catch {
              return null;
            }
          };

          const collectAnchors = (selectors = []) => {
            const gathered = [];
            const seen = new Set();
            for (const selector of selectors) {
              const nodes = document.querySelectorAll(selector);
              for (const node of nodes) {
                if (!(node instanceof HTMLAnchorElement)) continue;
                if (seen.has(node)) continue;
                seen.add(node);
                gathered.push(node);
              }
            }
            return gathered;
          };

          const addAnchors = (anchors, { requireHeading = false } = {}) => {
            const results = [];
            const seen = new Set();

            const push = (href) => {
              if (!href || seen.has(href)) return false;
              seen.add(href);
              results.push(href);
              return results.length >= maxResults;
            };

            for (const anchor of anchors) {
              if (!(anchor instanceof HTMLAnchorElement)) continue;
              if (requireHeading && !anchor.querySelector("h3")) continue;
              const datasetHref =
                anchor.getAttribute("data-url") ||
                anchor.getAttribute("data-href") ||
                anchor.dataset?.url ||
                anchor.dataset?.href ||
                "";
              const normalized = normalizeCandidate(
                anchor.getAttribute("href") ||
                  datasetHref ||
                  anchor.href ||
                  ""
              );
              if (push(normalized)) break;
            }
            return results;
          };

          const collectOnce = () => {
            const host = location.hostname;
            let anchors = [];
            let requireHeading = false;

            if (/google\./i.test(host)) {
              anchors = collectAnchors([
                "#search a[href][data-ved][jsname]",
                "#search a[jsname='UWckNb'][href]",
                "#search a[jsname='V68bde'][href]",
                "#search a[href][data-ved]",
                "#search a[href]",
                "[role='main'] a[href][data-ved]",
                "[role='main'] a[jsname][href]"
              ]);
            } else if (/bing\.com$/i.test(host)) {
              anchors = collectAnchors(["li.b_algo h2 a", "[role='main'] li.b_algo h2 a"]);
              requireHeading = true;
            } else if (/duckduckgo\.com$/i.test(host)) {
              anchors = collectAnchors([
                'a[data-testid="result-title-a"]',
                ".result__a",
                "[role='main'] a[data-testid='result-title-a']"
              ]);
            } else if (/yahoo\.com$/i.test(host)) {
              anchors = collectAnchors(["#web h3 a", "#web a.ac-algo"]);
              requireHeading = true;
            } else {
              anchors = collectAnchors(["main a[href]", "[role='main'] a[href]", "a.result__a"]);
            }

            if (!anchors.length) {
              anchors = collectAnchors(["main a[href]", "[role='main'] a[href]", "#search a[href]"]);
            }

            let results = addAnchors(anchors, { requireHeading });

            if (results.length < maxResults) {
              const fallback = addAnchors(
                collectAnchors([
                  "main a[href]",
                  "[role='main'] a[href]",
                  "#links a[href]",
                  "#results a[href]",
                  "#search a[href]"
                ])
              );
              const merged = new Set(results);
              for (const item of fallback) {
                if (!merged.has(item)) {
                  results.push(item);
                  merged.add(item);
                  if (results.length >= maxResults) break;
                }
              }
            }

            return results.slice(0, maxResults);
          };

          const cleanText = (text) => {
            if (!text) return "";
            return text
              .replace(/\u00a0/g, " ")
              .replace(/\s+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .replace(/[ \t]{2,}/g, " ")
              .trim();
          };

          const dedupe = (items) => {
            const seen = new Set();
            const out = [];
            for (const item of items) {
              const key = item.trim();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              out.push(item);
            }
            return out;
          };

          const extractAiAnswer = () => {
            const ANSWER_SELECTORS = [
              '[data-sfe="answer"]',
              '[data-sfe="answer"] article',
              '[data-sfe="ai_answer"]',
              '[data-sfe="ai_response"]',
              '[data-sfe="responsive_answer"]',
              '[data-ai-answer-component]',
              'section[data-attrid="wa:/results"]',
              'div[jscontroller="Acetsd"]',
              'div[jscontroller="kYr3ec"]',
              'div[jscontroller="ewa7dc"]',
              'div[jsname="TVKpob"]',
              'div[jsname="yVl2pb"]',
              'div[jsname="r6xKte"]',
              'div[jsname="W297wb"]',
              '[aria-live="polite"] [data-sfe="answer"]',
              '[aria-live="polite"] [jsname="TVKpob"]',
              '[aria-live="polite"] article',
              'main article',
              'main [data-ai-answer-component]'
            ];

            const candidateTexts = [];
            const seenNodes = new Set();

            for (const selector of ANSWER_SELECTORS) {
              const nodes = document.querySelectorAll(selector);
              for (const node of nodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (seenNodes.has(node)) continue;
                const text = cleanText(node.innerText || "");
                if (!text || text.length < 40) continue;
                candidateTexts.push(text);
                seenNodes.add(node);
              }
            }

            if (!candidateTexts.length) {
              const liveRegions = Array.from(document.querySelectorAll('[aria-live]'));
              for (const region of liveRegions) {
                const text = cleanText(region?.innerText || "");
                if (!text || text.length < 40) continue;
                candidateTexts.push(text);
                break;
              }
            }

            if (!candidateTexts.length) return null;
            const deduped = dedupe(candidateTexts);
            if (!deduped.length) return null;
            const primary = deduped.reduce((best, current) => (current.length > best.length ? current : best), "");
            if (!primary) return null;
            const paragraphs = primary.split(/\n{2,}/).map((p) => cleanText(p)).filter(Boolean);
            const firstMeaningfulParagraph = paragraphs.find((p) => p.length >= 40) || paragraphs[0] || "";
            let summary = firstMeaningfulParagraph;
            if (!summary && primary) {
              const sentences = primary.split(/(?<=\.)\s+/).filter(Boolean);
              summary = sentences.slice(0, 2).join(" ");
            }
            if (!summary && primary) {
              summary = primary;
            }
            if (summary.length > 400) summary = summary.slice(0, 400);
            const full = primary.length > MAX_AI_TEXT_LENGTH ? primary.slice(0, MAX_AI_TEXT_LENGTH) : primary;
            return { summary, full };
          };

          const attemptCollection = async () => {
            let latest = { searchResults: [], aiSummary: null, aiAnswer: null, ready: false };
            if (!window.__qtrackAiState) {
              window.__qtrackAiState = { signature: null, stable: 0 };
            }
            const state = window.__qtrackAiState;

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
              const searchResults = dedupe(collectOnce());
              let aiSummary = null;
              let aiFull = null;

              if (isAiMode) {
                const ai = extractAiAnswer();
                if (ai) {
                  aiSummary = ai.summary || null;
                  aiFull = ai.full || null;
                  if (aiSummary && isAiPlaceholderSummary(aiSummary)) {
                    aiSummary = null;
                    aiFull = null;
                  }
                }
              }

              const payload = {
                searchResults,
                aiSummary,
                aiAnswer: aiFull,
                ready: false
              };

              const signature = JSON.stringify([
                searchResults,
                aiSummary || "",
                aiFull || ""
              ]);

              if (state.signature === signature) {
                state.stable = (state.stable || 0) + 1;
              } else {
                state.signature = signature;
                state.stable = 0;
              }

              const aiReady = !isAiMode || Boolean(aiSummary);
              const stable = isAiMode ? state.stable >= 1 : true;

              if (aiReady && stable) {
                payload.ready = true;
                return payload;
              }

              latest = payload;
              await wait(ATTEMPT_DELAY_MS);
            }

            return latest;
          };

          return attemptCollection();
        },
        args: [10, { googleAiMode: isAiMode }]
      });
      const result = injection?.[0]?.result;
      if (!result || typeof result !== "object") {
        continue;
      }
      if (result.ready === false && attempt < MAX_INJECTION_ATTEMPTS - 1) {
        await sleep(INJECTION_DELAY_MS);
        continue;
      }
      const rawResults = Array.isArray(result.searchResults) ? result.searchResults : [];
      const normalizedResults = rawResults.map((href) => {
        try {
          return new URL(href).href;
        } catch {
          return href;
        }
      });
      const summaryText = typeof result.aiSummary === "string" ? result.aiSummary.trim() : "";
      const answerText = typeof result.aiAnswer === "string" ? result.aiAnswer.trim() : "";
      const combined = [];
      if (summaryText) {
        combined.push(`AI Summary: ${summaryText}`);
      }
      if (answerText && answerText !== summaryText) {
        combined.push(`AI Answer: ${answerText}`);
      }
      for (const href of normalizedResults) {
        if (href && !combined.includes(href)) combined.push(href);
      }
      return {
        ready: result.ready === true,
        items: combined,
        summary: summaryText || null,
        answer: answerText || null
      };
    } catch (e) {
      const message = e?.message || "";
      const retryable = /No frame|Cannot access contents|The tab was closed/i.test(message);
      if (retryable && attempt < MAX_INJECTION_ATTEMPTS - 1) {
        await sleep(INJECTION_DELAY_MS);
        continue;
      }
      console.warn("[tracker] search results scrape failed", e);
      break;
    }
  }
  return null;
}

async function logNavigationEvent({ tabId, url, questionId, source }) {
  const canonicalUrl = canonicalizeUrlForLogging(url) || url;
  const entry = {
    ts: new Date().toISOString(),
    url: canonicalUrl,
    questionId,
    responseId,
    source
  };

  try {
    const extraction = await maybeExtractSearchResults(tabId, url);
    if (extraction && extraction.ready === false) {
      return;
    }
    if (extraction && Array.isArray(extraction.items) && extraction.items.length) {
      entry.searchResults = extraction.items;
    }
  } catch (e) {
    console.warn("[tracker] search results capture error", e);
  }

  const dedupeKey = `${tabId}|${canonicalUrl}|${questionId || ""}`;
  const signature = entry.searchResults && entry.searchResults.length
    ? JSON.stringify(entry.searchResults)
    : "__URL_ONLY__";
  const prevSignature = lastSearchCaptureByTab.get(dedupeKey);
  if (prevSignature === signature) {
    return;
  }
  lastSearchCaptureByTab.set(dedupeKey, signature);

  await enqueue(entry);
}

async function injectContentScriptToTab(tabId) {
  if (tabId == null) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
    console.log("[tracker] injected content.js into tab", tabId);
  } catch (e) {
    console.warn("[tracker] failed to inject content.js into tab", tabId, e);
  }
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

async function enqueue(entry) {
  console.log("[tracker] enqueue", entry);
  const stored = await appendLogEntry(entry);
  if (!stored) return;
  queue.push(toUploadEvent(stored));
  if (queue.length >= BATCH_SIZE) {
    await flush();
  }
}

async function flush() {
  if (!collectorUrl || queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  console.log("[tracker] flushing", batch.length, "events to", collectorUrl);
  try {
    const payload = {
      events: batch.map(({ __logId, ...event }) => event)
    };
    const resp = await fetch(collectorUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
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
let responseId = null;
let collectorUrl = COLLECTOR_URL;
let queue = [];
const createdTabs = new Set(); // tabs just created via onCreatedNavigationTarget
let lastQuestionSeenAt = 0;              // ms epoch of last CONTEXT_UPDATE

// last seen question id from any Qualtrics page
let activeQuestionId = null;
let surveyStopRecorded = false;
let surveyStopReason = null;
const lastSearchCaptureByTab = new Map(); // `${tabId}|${url}` -> signature

let logState = {
  responseId: null,
  entries: [],
  removedCount: 0,
  syncedAt: null,
  updatedAt: null
};
let logsLoaded = false;
const logStateReady = chrome.storage.local
  .get([LOG_STATE_KEY])
  .then((res) => {
    const stored = res?.[LOG_STATE_KEY];
    if (stored && typeof stored === "object") {
      const entries = Array.isArray(stored.entries) ? stored.entries : [];
      logState = {
        responseId: stored.responseId || null,
        entries,
        removedCount: Number.isFinite(stored.removedCount) ? stored.removedCount : 0,
        syncedAt: stored.syncedAt || stored.finalizedAt || null,
        updatedAt: stored.updatedAt || null
      };
    }
  })
  .catch((e) => {
    console.warn("[tracker] failed to load log state", e);
  })
  .finally(() => {
    logsLoaded = true;
  });
async function ensureLogStateLoaded() {
  if (logsLoaded) return;
  await logStateReady;
}

function cloneEntry(entry) {
  const clone = entry && typeof entry === "object" ? { ...entry } : {};
  if (Array.isArray(entry.searchResults)) {
    clone.searchResults = entry.searchResults.slice();
  }
  return clone;
}

function serializeLogState(state) {
  return {
    responseId: state.responseId || null,
    entries: Array.isArray(state.entries) ? state.entries.map((entry) => {
      const clone = cloneEntry(entry) || {};
      return {
        ...clone,
        id: entry.id
      };
    }) : [],
    removedCount: Number.isFinite(state.removedCount) ? state.removedCount : 0,
    syncedAt: state.syncedAt || null,
    updatedAt: state.updatedAt || null
  };
}

async function persistLogState() {
  await ensureLogStateLoaded();
  const payload = serializeLogState(logState);
  try {
    await chrome.storage.local.set({ [LOG_STATE_KEY]: payload });
  } catch (e) {
    console.warn("[tracker] failed to persist log state", e);
  }
}

async function resetLogState(newResponseId = null) {
  await ensureLogStateLoaded();
  const nowIso = new Date().toISOString();
  logState = {
    responseId: newResponseId,
    entries: [],
    removedCount: 0,
    syncedAt: null,
    updatedAt: nowIso
  };
  queue.length = 0;
  await persistLogState();
}

function generateLogId() {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function appendLogEntry(entry) {
  await ensureLogStateLoaded();
  if (!responseId) return null;

  if (!logState.responseId || logState.responseId !== responseId) {
    await resetLogState(responseId);
  }

  const storedEntry = {
    ...cloneEntry(entry),
    id: generateLogId()
  };
  if (!storedEntry.responseId) {
    storedEntry.responseId = responseId || logState.responseId || null;
  }
  const nowIso = new Date().toISOString();
  logState.entries.push(storedEntry);
  logState.updatedAt = nowIso;
  await persistLogState();
  return storedEntry;
}

async function removeLogEntryById(id) {
  await ensureLogStateLoaded();
  if (!id) return { removed: false };
  const idx = logState.entries.findIndex((entry) => entry.id === id);
  if (idx === -1) return { removed: false };
  const [removedEntry] = logState.entries.splice(idx, 1);
  logState.removedCount = (logState.removedCount || 0) + 1;
  logState.updatedAt = new Date().toISOString();
  await persistLogState();
  purgeQueuedEntriesById(id);
  return {
    removed: true,
    remaining: logState.entries.length,
    removedEntry,
    index: idx
  };
}

function toUploadEvent(entry) {
  if (!entry || typeof entry !== "object") return {};
  const { id, ...rest } = entry;
  const clone = { ...rest };
  if (!clone.responseId) {
    clone.responseId = logState.responseId || responseId || null;
  }
  if (Array.isArray(clone.searchResults)) {
    clone.searchResults = clone.searchResults.slice();
  }
  return { __logId: id || null, ...clone };
}

async function getLogReviewSnapshot() {
  await ensureLogStateLoaded();
  return {
    responseId: logState.responseId || responseId || null,
    removedCount: logState.removedCount || 0,
    syncedAt: logState.syncedAt || null,
    entries: logState.entries.map(({ id, ts, url }) => ({
      id,
      ts,
      url
    }))
  };
}

function purgeQueuedEntriesById(logId) {
  if (!logId) return;
  if (!Array.isArray(queue) || queue.length === 0) return;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i]?.__logId === logId) {
      queue.splice(i, 1);
    }
  }
}

async function uploadLogSnapshot(entries, meta = {}) {
  if (!collectorUrl) {
    throw new Error("Collector URL is not configured.");
  }
  const overwrite = meta?.overwrite === true;
  if ((!Array.isArray(entries) || entries.length === 0) && !overwrite) {
    throw new Error("Nothing to upload.");
  }

  const payloadEvents = Array.isArray(entries)
    ? entries.map((entry) => {
        const { __logId, ...event } = toUploadEvent(entry);
        return event;
      })
    : [];

  const payload = {
    events: payloadEvents
  };

  const metaPayload = {};
  if (overwrite) {
    payload.overwrite = true;
    metaPayload.overwrite = true;
  }
  if (meta.responseId) {
    payload.responseId = meta.responseId;
    metaPayload.responseId = meta.responseId;
  }
  if (meta.removedCount != null) {
    payload.removedCount = meta.removedCount;
    metaPayload.removedCount = meta.removedCount;
  }
  if (Object.keys(metaPayload).length) {
    payload.meta = metaPayload;
  }

  const resp = await fetch(collectorUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    throw new Error(`Collector responded with ${resp.status}`);
  }
  return resp;
}

async function syncLogStateToCollector() {
  await ensureLogStateLoaded();
  if (!logState.responseId) return;
  const entries = Array.isArray(logState.entries) ? logState.entries.slice() : [];
  const syncedIds = new Set(entries.map((entry) => entry?.id).filter(Boolean));
  await uploadLogSnapshot(entries, {
    overwrite: true,
    responseId: logState.responseId,
    removedCount: logState.removedCount || 0
  });
  if (syncedIds.size && Array.isArray(queue) && queue.length) {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const entryId = queue[i]?.__logId;
      if (entryId && syncedIds.has(entryId)) {
        queue.splice(i, 1);
      }
    }
  }
  logState.syncedAt = new Date().toISOString();
  logState.updatedAt = logState.syncedAt;
  await persistLogState();
}

async function ensureActiveLogSession(newResponseId) {
  if (!newResponseId) return;
  await ensureLogStateLoaded();
  if (!logState.responseId) {
    await resetLogState(newResponseId);
    return;
  }
  if (logState.responseId !== newResponseId) {
    console.warn("[tracker] responseId changed; resetting stored logs.", logState.responseId, "->", newResponseId);
    await resetLogState(newResponseId);
  }
}

// ====== KEEP SERVICE WORKER ALIVE ======
// Chrome suspends service workers after ~30s of inactivity.
// Keep alive by pinging chrome.runtime every 20s when tracking is active.
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return; // already running
  console.log("[tracker] Starting keep-alive ping");

  keepAliveInterval = setInterval(() => {
    if (trackingActive && activeQuestionId) {
      // Lightweight API call to prevent service worker suspension
      chrome.runtime.getPlatformInfo(() => {
        // This callback keeps the service worker alive
      });
    } else {
      // Stop pinging if tracking is inactive
      stopKeepAlive();
    }
  }, 20000); // Every 20 seconds (well under the 30s timeout)
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    console.log("[tracker] Stopping keep-alive ping");
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// which tabs are currently on a Qualtrics page
const qualtricsTabs = new Set(); // Set<tabId>

// external tabId -> stamped questionId
const tabQuestion = new Map(); // Map<tabId, questionId>

async function markSurveyStopped(reason = "survey complete", { force = false } = {}) {
  if (surveyStopRecorded && !force) return;

  surveyStopRecorded = true;
  surveyStopReason = reason;
  trackingActive = false;
  activeQuestionId = null;
  lastQuestionSeenAt = 0;

  qualtricsTabs.clear();
  tabQuestion.clear();
  lastFocusByTab.clear();
  lastSearchCaptureByTab.clear();
  stopKeepAlive();

  const payload = {
    trackingActive: false,
    currentResponseId: responseId,
    __stoppedBySurvey: true,
    __stoppedReason: reason,
    __stoppedAt: new Date().toISOString()
  };

  try {
    await chrome.storage.local.set(payload);
  } catch (e) {
    console.warn("[tracker] failed to persist stop state", e);
  }

  flush();
  console.log("[tracker] STOP_BY_SURVEY:", reason);
}

// ====== INIT / SETTINGS ======
async function loadSettings() {
  const {
    trackingActive: ta,
    currentResponseId: rid,
    currentresponseId: legacyRid,
    __stoppedBySurvey: stoppedFlag,
    __stoppedReason: stoppedReason
  } = await chrome.storage.local.get([
    "trackingActive",
    "currentResponseId",
    "currentresponseId",
    "__stoppedBySurvey",
    "__stoppedReason"
  ]);

  trackingActive = !!ta;
  responseId = rid || legacyRid || null;
  surveyStopRecorded = !!stoppedFlag;
  surveyStopReason = stoppedReason || null;
  if (responseId) {
    await ensureActiveLogSession(responseId);
  }

  // migrate legacy key if present
  if (!rid && legacyRid) {
    await chrome.storage.local.set({ currentResponseId: legacyRid });
    await chrome.storage.local.remove("currentresponseId");
  }

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
    const url = new URL(u);
    return canonicalizeUrlObject(url).toString();
  } catch { return u; }
}

async function handleTopFrameNav(details, sourceLabel) {
  if (!trackingActive || !responseId) return;

  const { tabId, url, transitionType, frameId } = details;

  // Only top frame + http(s) + not Qualtrics
  if (frameId !== 0) return;
  if (!url || !isHttpLike(url)) return;
  if (isQualtrics(url)) return;

  // For onHistoryStateUpdated, transitionType may be undefined; that's fine
  if (transitionType && !ALLOWED_TRANSITIONS.includes(transitionType)) return;

  // Must have seen a question (Qx) this session
  if (!activeQuestionId) return;

  const wasCreated = createdTabs.has(tabId);
  if (wasCreated) {
    createdTabs.delete(tabId);
  }

  // Drop exact-recent duplicates (commit + history, quick redirects, etc.)
  if (isDup(tabId, url)) return;

  // Determine question id for this tab
  let q = tabQuestion.get(tabId);
  const wasQualtricsTab = qualtricsTabs.has(tabId);

  // If this was a Qualtrics tab navigating out (same-tab case), stamp now
  if (!q && wasQualtricsTab) {
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

  // Mark dedupe so a same-URL history/commit pair doesn't double-log
  markDedup(tabId, url);

  await logNavigationEvent({
    tabId,
    url,
    questionId: q,
    source: wasCreated ? "new_tab" : sourceLabel // treat created tabs as new_tab
  });
}


chrome.webNavigation.onHistoryStateUpdated.addListener((details) =>
  handleTopFrameNav(details, "same_tab")
);

// ====== MESSAGES FROM POPUP / CONTENT ======
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender?.tab?.id;

  if (msg?.type === "GET_LOGS") {
    (async () => {
      try {
        const snapshot = await getLogReviewSnapshot();
        sendResponse?.({
          ok: true,
          ...snapshot,
          trackingActive,
          surveyStopped: surveyStopRecorded,
          surveyStopReason,
          hasTrackingContext: Boolean(activeQuestionId)
        });
      } catch (e) {
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "REMOVE_LOG") {
    (async () => {
      try {
        const removal = await removeLogEntryById(msg.id);
        if (!removal.removed) {
          sendResponse?.({ ok: false, error: "Entry not found." });
          return;
        }

        try {
          await syncLogStateToCollector();
        } catch (syncError) {
          if (removal.removedEntry) {
            logState.entries.splice(removal.index ?? logState.entries.length, 0, removal.removedEntry);
            logState.removedCount = Math.max(0, (logState.removedCount || 1) - 1);
            logState.updatedAt = new Date().toISOString();
            await persistLogState();
          }
          throw syncError;
        }

        const snapshot = await getLogReviewSnapshot();
        sendResponse?.({
          ok: true,
          ...snapshot
        });
      } catch (e) {
        sendResponse?.({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (msg?.type === "START_TRACKING") {
    trackingActive = true;
    responseId = msg.responseId || responseId;
    surveyStopRecorded = false;
    surveyStopReason = null;
    if (responseId) {
      ensureActiveLogSession(responseId).catch((e) => console.warn("[tracker] ensureActiveLogSession failed (START_TRACKING)", e));
    }
    chrome.storage.local.set({ trackingActive: true, currentResponseId: responseId, __stoppedBySurvey: false, __stoppedReason: null, __stoppedAt: null });
    startKeepAlive();
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "STOP_TRACKING") {
    trackingActive = false;
    surveyStopRecorded = false;
    surveyStopReason = null;
    chrome.storage.local.set({ trackingActive: false });
    stopKeepAlive();
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg?.type === "STOP_BY_SURVEY") {
    markSurveyStopped(msg.reason || "survey complete", { force: true })
      .then(() => sendResponse?.({ ok: true }))
      .catch((e) => {
        console.warn("[tracker] STOP_BY_SURVEY persist failed", e);
        sendResponse?.({ ok: false });
      });
    return true;
  }

  if (msg?.type === "CONTEXT_UPDATE" && tabId != null) {
    // mark this as a Qualtrics tab
    qualtricsTabs.add(tabId);

    // adopt ResponseID (rid) from Qualtrics & auto-start
    if (msg.rid) {
      responseId = msg.rid;
      trackingActive = true; // auto-start on first context
      surveyStopRecorded = false;
      surveyStopReason = null;
      ensureActiveLogSession(responseId).catch((e) => console.warn("[tracker] ensureActiveLogSession failed (CONTEXT_UPDATE)", e));
      chrome.storage.local.set({ currentResponseId: responseId, trackingActive: true, __stoppedBySurvey: false, __stoppedReason: null, __stoppedAt: null });
    }

    const q = msg.questionId || null;
    if (q && q !== activeQuestionId) {
    activeQuestionId = q;
    lastQuestionSeenAt = Date.now();
    chrome.storage.local.set({ __activeQuestionId: activeQuestionId });
    lastFocusByTab.clear();  // <-- reset focus throttle on question change
    startKeepAlive(); // Ensure keep-alive is running when we have an active question
    console.log("[tracker] activeQuestionId ->", activeQuestionId, "rid:", responseId || "");
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
    if (!trackingActive || !activeQuestionId || !responseId) return;
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

    await enqueue({
      ts: new Date().toISOString(),
      url,
      questionId: activeQuestionId,  // <-- always current Q for tab_focus
      responseId,
      source: "tab_focus"
    });

  } catch (e) {
    console.warn("[tracker] onActivated error", e);
  }
});

// ====== NAVIGATION CAPTURE ======

// 1) New tab opened (Ctrl/⌘-click, window.open, context menu)
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  if (!trackingActive || !responseId) return;

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

  // prevent duplicate when onCommitted fires right after creation (redirect/canon)
  createdTabs.add(tabId);
});

// 2) Same-tab out of Qualtrics + subsequent hops in external tabs
chrome.webNavigation.onCommitted.addListener((details) =>
  handleTopFrameNav(details, "same_tab")
);

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

// ====== EXTENSION LIFECYCLE ======
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install" && details.reason !== "update") {
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ url: QUALTRICS_URL_PATTERNS });
    await Promise.all(tabs.map(({ id }) => injectContentScriptToTab(id)));
  } catch (e) {
    console.warn("[tracker] onInstalled injection failed", e);
  }
});
