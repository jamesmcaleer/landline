import { captureSession } from "./capture.js";

// Placeholder until pairing/backend exist. The number is the real mechanism;
// the QR is just a shortcut to it.
const LANDLINE_DISPLAY = "(617) 555-0142";
const LANDLINE_DIGITS = "+16175550142";
const ACCOUNTS_KEY = "landline.accounts";

// Runs as a real extension popup when the chrome APIs exist, and as a plain
// web page (for design preview) otherwise, using mock data.
const isExtension = typeof chrome !== "undefined" && !!chrome.tabs && !!chrome.storage;

// --- site identity helpers ------------------------------------------------

function prettyName(domain) {
  const labels = domain.replace(/^www\./, "").split(".");
  const core = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

// Stable vivid color from a domain, so each site gets a consistent tile.
function colorFromDomain(domain) {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 42%)`;
}

function siteFromTab(tab) {
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) return null;
  const domain = new URL(tab.url).hostname;
  const name = prettyName(domain);
  return {
    domain,
    name,
    letter: name.charAt(0).toUpperCase(),
    color: colorFromDomain(domain),
    favIconUrl: tab.favIconUrl || "",
  };
}

function sinceText(ts) {
  const mins = (Date.now() - ts) / 60000;
  if (mins < 1) return "Added just now";
  if (mins < 60) return `Connected ${Math.round(mins)} min ago`;
  const hrs = mins / 60;
  if (hrs < 24) return "Connected today";
  const days = Math.round(hrs / 24);
  if (days < 7) return `Connected ${days} day${days > 1 ? "s" : ""} ago`;
  const wks = Math.round(days / 7);
  return `Connected ${wks} week${wks > 1 ? "s" : ""} ago`;
}

// --- storage --------------------------------------------------------------

async function loadAccounts() {
  if (!isExtension) return mockAccounts();
  const got = await chrome.storage.local.get(ACCOUNTS_KEY);
  return got[ACCOUNTS_KEY] || [];
}

async function saveAccounts(accounts) {
  if (!isExtension) return;
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
}

function mockAccounts() {
  const base = Date.now();
  return [
    { domain: "coned.com", name: "Con Edison", letter: "C", color: "hsl(214 55% 42%)", favIconUrl: "", since: base - 3 * 864e5 },
    { domain: "cvs.com", name: "CVS Pharmacy", letter: "C", color: "hsl(318 55% 42%)", favIconUrl: "", since: base - 8 * 864e5 },
    { domain: "spectrum.net", name: "Spectrum", letter: "S", color: "hsl(168 55% 38%)", favIconUrl: "", since: base - 60 * 864e5 },
  ];
}

// --- capture download (until upload exists) -------------------------------

function downloadJson(obj, domain) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `landline-session-${domain}-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- QR placeholder (decorative until pairing exists) ---------------------

function qrPath() {
  const n = 25;
  let d = "";
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const finder = (x, y, cx, cy) => {
    const dx = x - cx, dy = y - cy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
    const edge = dx === 0 || dy === 0 || dx === 6 || dy === 6;
    const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
    return edge || core;
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let f = finder(x, y, 0, 0);
      if (f === null) f = finder(x, y, 18, 0);
      if (f === null) f = finder(x, y, 0, 18);
      let on;
      if (f !== null) on = f;
      else if (y === 6) on = x % 2 === 0;
      else if (x === 6) on = y % 2 === 0;
      else on = rnd() < 0.5;
      if (on) d += `M${x} ${y}h1v1h-1z`;
    }
  }
  return d;
}

// --- icons ----------------------------------------------------------------

const ic = {
  message: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4C7 4 3 7.1 3 11c0 2.1 1.2 4 3.1 5.3L5.5 20l3.9-2.1c.8.2 1.7.3 2.6.3 5 0 9-3.1 9-7s-4-7.2-9-7.2z"/></svg>`,
  spinner: `<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  warn: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9a5800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>`,
  globe: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`,
  back: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
};

function tileHtml(obj, cls = "tile") {
  if (obj.favIconUrl) return `<img class="${cls}" src="${obj.favIconUrl}" alt="" style="background:${obj.color}">`;
  return `<span class="${cls}" style="background:${obj.color}">${obj.letter}</span>`;
}

// --- app ------------------------------------------------------------------

const state = {
  screen: "home", // home | scan | manage | error
  adding: false,
  site: null,
  accounts: [],
  confirming: null, // domain being revoke-confirmed
};

const bodyEl = document.getElementById("body");
const accountsBtn = document.getElementById("accounts-btn");
const countPill = document.getElementById("count-pill");

function isConnected(domain) {
  return state.accounts.some((a) => a.domain === domain);
}

function render() {
  const onHome = state.screen === "home" || state.screen === "error";
  accountsBtn.hidden = !onHome;
  countPill.textContent = state.accounts.length;

  if (state.screen === "scan") bodyEl.innerHTML = scanScreen();
  else if (state.screen === "manage") bodyEl.innerHTML = manageScreen();
  else bodyEl.innerHTML = homeScreen();

  bind();
}

function homeScreen() {
  const s = state.site;
  let card;
  if (state.screen === "error") {
    card = `<div class="card swap"><div class="center-col swap" role="alert">
      <div class="spacer"></div>
      <span class="tile tile-warn">${ic.warn}</span>
      <span class="title sm">${s ? s.name : "That"} wasn’t added</span>
      <span class="sub">Check your internet, then try again.</span>
      <div class="spacer"></div>
      <button class="x-btn g-blue btn-primary" data-act="add">Try again</button>
    </div>${manageLink()}</div>`;
  } else if (!s) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      <span class="tile tile-ghost">${ic.globe}</span>
      <span class="title sm">Open a site you use</span>
      <span class="sub">Go to a website you’re signed in to, like your phone, power, or pharmacy account. Then open Landline again.</span>
      <div class="spacer"></div>
    </div>${manageLink()}</div>`;
  } else if (state.adding) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      ${tileHtml(s)}
      <span class="title" style="margin-top:6px">${s.name}</span>
      <span class="sub">Add it to iMessage. Then text to check your bill or make a change.</span>
      <div class="spacer"></div>
      <button class="x-btn g-blue btn-primary" disabled style="opacity:.9;gap:10px">${ic.spinner}<span role="status">Adding…</span></button>
    </div></div>`;
  } else if (isConnected(s.domain)) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      <span class="tile-wrap">${tileHtml(s)}<span class="tile-badge">${ic.check}</span></span>
      <span class="title md" style="margin-top:10px">${s.name} is on iMessage</span>
      <span class="sub">Text the number below anytime to check your bill or make a change.</span>
      <div class="spacer"></div>
    </div>${manageLink()}</div>`;
  } else {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      ${tileHtml(s)}
      <span class="eyebrow">On this tab</span>
      <span class="title">${s.name}</span>
      <span class="sub">Add it to iMessage. Then text to check your bill or make a change.</span>
      <div class="spacer"></div>
      <button class="x-btn g-blue btn-primary" data-act="add">${ic.message} Add to iMessage</button>
    </div>${manageLink()}</div>`;
  }
  return card;
}

function manageLink() {
  const n = state.accounts.length;
  if (n === 0) {
    return `<button class="x-btn l-ghost manage-link" data-act="manage"><span class="count-text mute">No accounts connected yet</span>${ic.chevron}</button>`;
  }
  const stack = state.accounts.slice(0, 4).map((a) =>
    a.favIconUrl ? `<img class="avatar" src="${a.favIconUrl}" alt="" style="background:${a.color}">` : `<span class="avatar" style="background:${a.color}">${a.letter}</span>`
  ).join("");
  const text = n === 1 ? "1 account connected" : `${n} accounts connected`;
  return `<button class="x-btn l-ghost manage-link" data-act="manage"><span class="avatar-stack">${stack}</span><span class="count-text">${text}</span>${ic.chevron}</button>`;
}

function scanScreen() {
  return `<div class="card flush swap" style="align-items:center;text-align:center;gap:12px">
    <div class="scan-top"><button class="x-btn icon-btn left" data-act="back" aria-label="Back">${ic.back}</button></div>
    <span class="title sm" style="text-wrap:balance">Scan with your iPhone camera</span>
    <div class="qr-frame"><svg viewBox="0 0 25 25" width="168" height="168" shape-rendering="crispEdges" role="img" aria-label="Code that opens Messages to ${LANDLINE_DISPLAY}"><path d="${qrPath()}" fill="#0d0f14"/></svg></div>
    <span class="sub" style="max-width:290px">It opens Messages with a text ready. Tap Send and you’re done.</span>
    <div class="spacer"></div>
    <button class="x-btn link-btn" data-act="done">Done</button>
  </div>`;
}

function manageScreen() {
  let inner;
  if (state.accounts.length === 0) {
    inner = `<div class="empty swap"><span class="title">No accounts yet</span><span class="sub" style="max-width:240px">Open a site you’re signed in to and press Add to iMessage.</span></div>`;
  } else {
    inner = `<div class="rows">${state.accounts.map(rowHtml).join("")}</div>`;
  }
  return `<div class="card flush swap">
    <div class="manage-head"><button class="x-btn icon-btn" data-act="back" aria-label="Back">${ic.back}</button><span class="title">Connected accounts</span></div>
    ${inner}
  </div>`;
}

function rowHtml(a) {
  const confirming = state.confirming === a.domain;
  const since = sinceText(a.since);
  const fresh = Date.now() - a.since < 60000;
  const main = `<div class="row-main">
    ${tileHtml(a, "row-tile")}
    <div class="row-meta"><span class="row-name">${a.name}</span><span class="row-since${fresh ? " fresh" : ""}">${since}</span></div>
    ${confirming ? "" : `<button class="x-btn l-red revoke-btn" data-act="ask" data-domain="${a.domain}">Revoke</button>`}
  </div>`;
  const confirm = confirming
    ? `<div class="confirm swap"><span class="confirm-text">You won’t be able to text about ${a.name} until you add it again.</span>
       <div class="confirm-row"><button class="x-btn l-red-solid btn-pair" data-act="remove" data-domain="${a.domain}">Revoke</button><button class="x-btn l-ghost btn-pair" data-act="keep">Keep</button></div></div>`
    : "";
  return `<div class="row swap">${main}${confirm}</div>`;
}

// --- actions --------------------------------------------------------------

async function startAdd() {
  state.adding = true;
  state.screen = "home";
  render();

  try {
    const site = state.site;
    if (isExtension) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const session = await captureSession(tab);
      downloadJson(session, session.site.domain);
    } else {
      await new Promise((r) => setTimeout(r, 1400)); // mock capture delay
    }
    state.accounts = [{ ...site, since: Date.now() }, ...state.accounts.filter((a) => a.domain !== site.domain)];
    await saveAccounts(state.accounts);
    state.adding = false;
    state.screen = "scan";
  } catch {
    state.adding = false;
    state.screen = "error";
  }
  render();
}

async function removeAccount(domain) {
  state.accounts = state.accounts.filter((a) => a.domain !== domain);
  state.confirming = null;
  await saveAccounts(state.accounts);
  render();
}

function bind() {
  bodyEl.querySelectorAll("[data-act]").forEach((el) => {
    const act = el.dataset.act;
    el.addEventListener("click", () => {
      if (act === "add") startAdd();
      else if (act === "manage") { state.screen = "manage"; render(); }
      else if (act === "back") { state.screen = "home"; state.confirming = null; render(); }
      else if (act === "done") { state.screen = "home"; render(); }
      else if (act === "ask") { state.confirming = el.dataset.domain; render(); }
      else if (act === "keep") { state.confirming = null; render(); }
      else if (act === "remove") removeAccount(el.dataset.domain);
    });
  });
}

accountsBtn.addEventListener("click", () => { state.screen = "manage"; render(); });

const copyBtn = document.getElementById("copy-btn");
copyBtn.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(LANDLINE_DIGITS); } catch {}
  copyBtn.querySelector(".copy-idle").hidden = true;
  copyBtn.querySelector(".copy-done").hidden = false;
  setTimeout(() => {
    copyBtn.querySelector(".copy-idle").hidden = false;
    copyBtn.querySelector(".copy-done").hidden = true;
  }, 1600);
});

async function init() {
  state.accounts = await loadAccounts();
  if (isExtension) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.site = siteFromTab(tab);
  } else {
    // Design preview: a connectable site that isn't yet connected. A URL hash
    // forces a specific screen for design review; ignored in the real popup.
    state.site = { domain: "verizon.com", name: "Verizon", letter: "V", color: "#c62a1f", favIconUrl: "" };
    const h = location.hash.slice(1);
    if (h === "nosite") state.site = null;
    else if (h === "empty") state.accounts = [];
    else if (h === "added") state.accounts = [{ ...state.site, since: Date.now() }, ...state.accounts];
    else if (h === "error") state.screen = "error";
    else if (h === "manage") state.screen = "manage";
  }
  render();
}

init();
