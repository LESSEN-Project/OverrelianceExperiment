async function get(keys) {
  return chrome.storage.local.get(keys);
}
async function set(obj) {
  return chrome.storage.local.set(obj);
}

const statusEl = document.getElementById('status');
const ridRowEl = document.getElementById('ridRow');
const ridValueEl = document.getElementById('ridValue');

async function refresh() {
  const {
    trackingActive,
    currentResponseId,
    __activeQuestionId,
    __stoppedBySurvey,
    __stoppedReason,
    __stoppedAt
  } = await get([
    'trackingActive',
    'currentResponseId',
    '__activeQuestionId',
    '__stoppedBySurvey',
    '__stoppedReason',
    '__stoppedAt'
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
    return;
  }

  if (__stoppedBySurvey) {
    statusEl.textContent = showrid
      ? 'Tracking stopped. Please copy your Response ID.'
      : 'Tracking is not active.';
  } else {
    statusEl.textContent = 'Tracking is not active.';
  }
  statusEl.className = 'hint warn';
}

chrome.storage.onChanged.addListener(refresh);
refresh();
