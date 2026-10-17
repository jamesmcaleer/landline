import { captureSession } from "./capture.js";

const domainEl = document.getElementById("site-domain");
const titleEl = document.getElementById("site-title");
const captureBtn = document.getElementById("capture");
const statusEl = document.getElementById("status");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function filenameFor(domain) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `landline-session-${domain}-${stamp}.json`;
}

// Downloads the capture as a JSON file. Step 1 writes to disk so the replay
// script can load it; the upload to the session service comes later.
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let activeTab = null;

async function init() {
  activeTab = await getActiveTab();
  if (activeTab && activeTab.url && /^https?:/.test(activeTab.url)) {
    domainEl.textContent = new URL(activeTab.url).hostname;
    titleEl.textContent = activeTab.title || "";
    captureBtn.disabled = false;
  } else {
    domainEl.textContent = "No website here";
    titleEl.textContent = "Open a site you're signed into.";
  }
}

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  statusEl.textContent = "Capturing…";
  try {
    const session = await captureSession(activeTab);
    downloadJson(session, filenameFor(session.site.domain));
    const originCount = session.origins.length;
    statusEl.textContent = `Captured ${session.cookies.length} cookies from ${originCount} origin(s).`;
  } catch (err) {
    statusEl.textContent = err.message || String(err);
  } finally {
    captureBtn.disabled = false;
  }
});

init();
