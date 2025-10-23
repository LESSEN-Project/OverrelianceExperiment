async function get(keys) {
  return chrome.storage.local.get(keys);
}
async function set(obj) {
  return chrome.storage.local.set(obj);
}

const infoEl = document.getElementById('info'); 
const statusEl = document.getElementById('status');

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

  if (trackingActive) {
    statusEl.textContent = 'Tracking Qualtrics activity...';
    statusEl.className = 'hint ok';
    return;
  }

  if (__stoppedBySurvey) {
    const when = __stoppedAt ? ` at ${new Date(__stoppedAt).toLocaleTimeString()}` : '';
    statusEl.textContent = `Tracking stopped.`;
  } else {
    statusEl.textContent = 'Tracking stopped.';
  }
  statusEl.className = 'hint warn';
}

chrome.storage.onChanged.addListener(refresh);
refresh();
