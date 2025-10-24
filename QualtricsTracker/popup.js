async function get(keys) {
  return chrome.storage.local.get(keys);
}
async function set(obj) {
  return chrome.storage.local.set(obj);
}

const statusEl = document.getElementById('status');
const pidRowEl = document.getElementById('pidRow');
const pidValueEl = document.getElementById('pidValue');

async function refresh() {
  const {
    trackingActive,
    currentProlificId,
    __activeQuestionId,
    __stoppedBySurvey,
    __stoppedReason,
    __stoppedAt
  } = await get([
    'trackingActive',
    'currentProlificId',
    '__activeQuestionId',
    '__stoppedBySurvey',
    '__stoppedReason',
    '__stoppedAt'
  ]);

  const showPid = Boolean(currentProlificId && __stoppedBySurvey);

  if (showPid) {
    pidValueEl.textContent = currentProlificId;
    pidRowEl.style.display = 'flex';
  } else {
    pidValueEl.textContent = '';
    pidRowEl.style.display = 'none';
  }

  if (trackingActive) {
    statusEl.textContent = 'Tracking Qualtrics activity...';
    statusEl.className = 'hint ok';
    return;
  }

  if (__stoppedBySurvey) {
    statusEl.textContent = showPid
      ? 'Tracking stopped. Please copy your Response ID.'
      : 'Tracking is not active.';
  } else {
    statusEl.textContent = 'Tracking is not active.';
  }
  statusEl.className = 'hint warn';
}

chrome.storage.onChanged.addListener(refresh);
refresh();
