const LOG_STATE_KEY = '__qtrack_log_state';

async function get(keys) {
  return chrome.storage.local.get(keys);
}
const statusEl = document.getElementById('status');
const ridRowEl = document.getElementById('ridRow');
const ridValueEl = document.getElementById('ridValue');
const reviewBtn = document.getElementById('reviewBtn');
const reviewSection = document.getElementById('reviewSection');
const logSummaryEl = document.getElementById('logSummary');
const logListEl = document.getElementById('logList');
const reviewMessageEl = document.getElementById('reviewMessage');

let reviewOpen = false;
let loadingLogs = false;
function setReviewMessage(text, tone = '') {
  if (!reviewMessageEl) return;
  reviewMessageEl.textContent = text || '';
  reviewMessageEl.className = tone ? `hint ${tone}` : 'hint';
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const dt = new Date(iso);
    return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function renderLogs(snapshot) {
  if (!logSummaryEl || !logListEl) return;
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];

  const showResponseId = snapshot?.surveyStopped && snapshot?.responseId;
  if (entries.length) {
    const parts = [`${entries.length} page${entries.length === 1 ? '' : 's'} tracked`];
    if (showResponseId) {
      parts.push(`for ${snapshot.responseId}`);
    }
    logSummaryEl.textContent = parts.join(' ');
  } else {
    logSummaryEl.textContent = 'No external pages tracked yet.';
  }

  logListEl.innerHTML = '';

  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'Nothing to review.';
    logListEl.appendChild(empty);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'log-item';
    item.dataset.id = entry.id;

    const time = document.createElement('div');
    time.className = 'log-meta';
    time.textContent = formatTime(entry.ts) || '(unknown time)';
    item.appendChild(time);

    const url = document.createElement('div');
    url.className = 'log-url';
    url.textContent = entry.url || '(unknown URL)';
    item.appendChild(url);

    const actions = document.createElement('div');
    actions.className = 'log-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.dataset.action = 'remove';
    removeBtn.dataset.id = entry.id;
    removeBtn.textContent = 'Remove';
    actions.appendChild(removeBtn);
    item.appendChild(actions);

    logListEl.appendChild(item);
  }
}

async function loadLogs({ keepMessage = false } = {}) {
  if (!reviewOpen || loadingLogs) return;
  loadingLogs = true;

  if (!keepMessage) {
    setReviewMessage('');
  }
  if (logSummaryEl) {
    logSummaryEl.textContent = 'Loading…';
  }
  if (logListEl) {
    logListEl.innerHTML = '';
  }

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    if (!response?.ok) {
      throw new Error(response?.error || 'Unable to load tracked URLs.');
    }
    renderLogs(response);
  } catch (e) {
    setReviewMessage(e.message || 'Failed to load tracked URLs.', 'warn');
  } finally {
    loadingLogs = false;
  }
}

async function removeLog(id) {
  if (!id) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'REMOVE_LOG', id });
    if (!response?.ok) {
      throw new Error(response?.error || 'Unable to remove entry.');
    }
    setReviewMessage('Entry removed from the record.', 'ok');
    renderLogs(response);
  } catch (e) {
    setReviewMessage(e.message || 'Failed to remove entry.', 'warn');
  }
}

function toggleReview() {
  if (!reviewSection || !reviewBtn) return;

  if (reviewOpen) {
    reviewOpen = false;
    reviewSection.classList.add('hidden');
    reviewBtn.textContent = 'Review tracked pages';
    setReviewMessage('');
    return;
  }

  reviewOpen = true;
  reviewSection.classList.remove('hidden');
  reviewBtn.textContent = 'Hide tracked pages';
  loadLogs();
}

async function refresh() {
  const {
    trackingActive,
    currentResponseId,
    __stoppedBySurvey
  } = await get([
    'trackingActive',
    'currentResponseId',
    '__stoppedBySurvey'
  ]);

  const showrid = Boolean(currentResponseId && __stoppedBySurvey);

  if (showrid) {
    ridValueEl.textContent = currentResponseId;
    ridRowEl.style.display = 'flex';
  } else {
    ridValueEl.textContent = '';
    ridRowEl.style.display = 'none';
  }

  if (trackingActive) {
    statusEl.textContent = 'Tracking Qualtrics activity...';
    statusEl.className = 'hint ok';
  } else if (__stoppedBySurvey) {
    statusEl.textContent = showrid
      ? 'Tracking stopped. Please copy your Response ID.'
      : 'Tracking is not active.';
    statusEl.className = 'hint warn';
  } else {
    statusEl.textContent = 'Tracking is not active.';
    statusEl.className = 'hint warn';
  }
}

if (reviewBtn) {
  reviewBtn.addEventListener('click', toggleReview);
}

if (logListEl) {
  logListEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action === 'remove' && target.dataset.id) {
      removeLog(target.dataset.id);
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  refresh();
  if (areaName === 'local' && changes[LOG_STATE_KEY] && reviewOpen) {
    loadLogs({ keepMessage: true });
  }
});

refresh();
