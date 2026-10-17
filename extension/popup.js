import { captureSession } from "./capture.js";

// The backend base URL is hardcoded, matching how the backend is configured.
const API_BASE = "http://localhost:3000";
const CONFIG_KEY = "landline.config"; // cached { phone, smsLink } for instant display

// Real extension when the chrome APIs exist; otherwise a plain web page for
// design preview, which uses mock data and never calls the server.
const isExtension = typeof chrome !== "undefined" && !!chrome.tabs;

// --- backend ---------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

const getConfig = () => api("GET", "/config");
const listConnections = () => api("GET", "/connections").then((r) => r.connections);
const createConnection = (site) => api("POST", "/connections", { site }).then((r) => r.connection);
const uploadSession = (id, session) =>
  api("PUT", `/connections/${id}/session`, { encoding: "plain", session }).then((r) => r.connection);
const deleteConnection = (id) => api("DELETE", `/connections/${id}`);

// --- site identity helpers -------------------------------------------------

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

// Display shape used by the UI, with the raw url/title kept for the connection.
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
    url: tab.url,
    title: tab.title || "",
  };
}

// A backend Connection mapped to the display shape the UI renders.
function toAccount(c) {
  const name = prettyName(c.site.domain);
  return {
    connectionId: c.id,
    domain: c.site.domain,
    name,
    letter: name.charAt(0).toUpperCase(),
    color: colorFromDomain(c.site.domain),
    favIconUrl: c.site.favIconUrl || "",
  };
}

// For the current site display object (siteFromTab) to appear in the list.
function siteAsAccount(s) {
  return { connectionId: null, domain: s.domain, name: s.name, letter: s.letter, color: s.color, favIconUrl: s.favIconUrl };
}

// +1XXXXXXXXXX -> (XXX) XXX-XXXX; otherwise shown as-is.
function formatPhone(p) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || "");
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || "";
}

function mockAccounts() {
  return [
    { connectionId: "con_mock1", domain: "coned.com", name: "Con Edison", letter: "C", color: "hsl(214 55% 42%)", favIconUrl: "" },
    { connectionId: "con_mock2", domain: "cvs.com", name: "CVS Pharmacy", letter: "C", color: "hsl(318 55% 42%)", favIconUrl: "" },
    { connectionId: "con_mock3", domain: "spectrum.net", name: "Spectrum", letter: "S", color: "hsl(168 55% 38%)", favIconUrl: "" },
  ];
}

// --- QR --------------------------------------------------------------------

// Real QR from the backend's sms link, rendered as an SVG path on an n x n grid.
function qrSvg(text) {
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { d, n };
}

// --- icons -----------------------------------------------------------------

const ic = {
  message: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4C7 4 3 7.1 3 11c0 2.1 1.2 4 3.1 5.3L5.5 20l3.9-2.1c.8.2 1.7.3 2.6.3 5 0 9-3.1 9-7s-4-7.2-9-7.2z"/></svg>`,
  spinner: `<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  warn: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9a5800" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/></svg>`,
  globe: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>`,
  back: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`,
  copy: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/></svg>`,
  copied: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#1f8a42" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  qr: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M14 14h2v2M20 14v.01M14 20h.01M18 18h2v2M18 20v.01"/></svg>`,
  offline: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5a9 9 0 0 1 14 0"/><path d="M8.5 15.5a4.5 4.5 0 0 1 7 0"/><path d="M12 19h.01"/><path d="M4 3l16 16"/></svg>`,
};

function tileHtml(obj, cls = "tile") {
  if (obj.favIconUrl) return `<img class="${cls}" src="${obj.favIconUrl}" alt="" style="background:${obj.color}">`;
  return `<span class="${cls}" style="background:${obj.color}">${obj.letter}</span>`;
}

// --- app -------------------------------------------------------------------

const state = {
  screen: "home", // home | scan | manage | error
  adding: false,
  offline: false, // true when the backend can't be reached
  site: null,
  accounts: [],
  config: null, // { phone, smsLink } from the backend
  confirming: null, // domain being revoke-confirmed
};

const bodyEl = document.getElementById("body");
const footEl = document.getElementById("foot");

function isConnected(domain) {
  return state.accounts.some((a) => a.domain === domain);
}

function render() {
  if (state.offline) bodyEl.innerHTML = offlineScreen();
  else if (state.screen === "scan") bodyEl.innerHTML = scanScreen();
  else if (state.screen === "manage") bodyEl.innerHTML = manageScreen();
  else bodyEl.innerHTML = homeScreen();

  renderFooter();
  bind();
}

// Shown when the backend can't be reached, so a server-down state is obvious
// rather than looking like a site or network problem.
function offlineScreen() {
  return `<div class="card swap"><div class="center-col swap" role="alert">
    <div class="spacer"></div>
    <span class="tile tile-ghost">${ic.offline}</span>
    <span class="title sm">Can’t reach Landline</span>
    <span class="sub">Landline isn’t responding. Make sure it’s running, then try again.</span>
    <div class="spacer"></div>
    <button class="x-btn g-blue btn-primary" data-act="retry">Try again</button>
  </div></div>`;
}

// The footer shows the Landline number once config has loaded from the server.
function renderFooter() {
  footEl.hidden = !state.config;
  if (!state.config) return;
  footEl.innerHTML = `
    <span class="foot-label">Text</span>
    <span class="foot-number">${formatPhone(state.config.phone)}</span>
    <button class="x-btn l-ghost foot-icon" data-act="copy" aria-label="Copy number">${ic.copy}</button>
    <button class="x-btn l-ghost foot-icon" data-act="qr" aria-label="Show QR code">${ic.qr}</button>`;
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
    </div></div>`;
  } else if (!s) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      <span class="tile tile-ghost">${ic.globe}</span>
      <span class="title sm">Open a site you use</span>
      <span class="sub">Go to a website you’re signed in to, like your phone, power, or pharmacy account. Then open Landline again.</span>
      <div class="spacer"></div>
    </div></div>`;
  } else if (state.adding) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      ${tileHtml(s)}
      <span class="title" style="margin-top:6px">${s.name}</span>
      <span class="sub">Connect this browser session to iMessage.</span>
      <div class="spacer"></div>
      <button class="x-btn g-blue btn-primary" disabled style="opacity:.9;gap:10px">${ic.spinner}<span role="status">Adding…</span></button>
    </div></div>`;
  } else if (isConnected(s.domain)) {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      <span class="tile-wrap">${tileHtml(s)}<span class="tile-badge">${ic.check}</span></span>
      <span class="title md" style="margin-top:10px">${s.name} is on iMessage</span>
      <span class="sub">Text the number below anytime.</span>
      <div class="spacer"></div>
    </div></div>`;
  } else {
    card = `<div class="card swap"><div class="center-col swap">
      <div class="spacer"></div>
      ${tileHtml(s)}
      <span class="eyebrow">On this tab</span>
      <span class="title">${s.name}</span>
      <span class="sub">Connect this browser session to iMessage.</span>
      <div class="spacer"></div>
      <button class="x-btn g-blue btn-primary" data-act="add">${ic.message} Add to iMessage</button>
    </div></div>`;
  }
  // The accounts count is its own widget below the main card, not part of it.
  return card + manageLink();
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
  const { d, n } = qrSvg(state.config ? state.config.smsLink : "sms:");
  return `<div class="card flush swap" style="align-items:center;text-align:center;gap:12px">
    <div class="scan-top"><button class="x-btn icon-btn left" data-act="back" aria-label="Back">${ic.back}</button></div>
    <span class="title sm" style="text-wrap:balance">Scan with your iPhone camera</span>
    <div class="qr-frame"><svg viewBox="0 0 ${n} ${n}" width="168" height="168" shape-rendering="crispEdges" role="img" aria-label="Code that opens a text to your Landline agent"><path d="${d}" fill="#0d0f14"/></svg></div>
    <span class="sub" style="max-width:290px">It opens a text to your Landline agent. Send a message to get started.</span>
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
  const main = `<div class="row-main">
    ${tileHtml(a, "row-tile")}
    <div class="row-meta"><span class="row-name">${a.name}</span><span class="row-since">Connected</span></div>
    ${confirming ? "" : `<button class="x-btn l-red revoke-btn" data-act="ask" data-domain="${a.domain}">Revoke</button>`}
  </div>`;
  const confirm = confirming
    ? `<div class="confirm swap"><span class="confirm-text">You won’t be able to text about ${a.name} until you add it again.</span>
       <div class="confirm-row"><button class="x-btn l-red-solid btn-pair" data-act="remove" data-domain="${a.domain}">Revoke</button><button class="x-btn l-ghost btn-pair" data-act="keep">Keep</button></div></div>`
    : "";
  return `<div class="row swap">${main}${confirm}</div>`;
}

// --- actions ---------------------------------------------------------------

// Two-step handshake: create a connection (starts a browser), then upload the
// captured session into it. loggedIn drives success vs error.
async function startAdd() {
  state.adding = true;
  state.screen = "home";
  render();

  try {
    if (isExtension) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const s = siteFromTab(tab);
      const conn = await createConnection({ domain: s.domain, title: s.title, favIconUrl: s.favIconUrl, url: s.url });
      const session = await captureSession(tab);
      const updated = await uploadSession(conn.id, session);
      if (!updated.loggedIn) {
        await deleteConnection(conn.id).catch(() => {});
        throw new Error("session did not log in");
      }
      state.accounts = (await listConnections()).map(toAccount);
    } else {
      await new Promise((r) => setTimeout(r, 1400)); // mock capture delay
      state.accounts = [siteAsAccount(state.site), ...state.accounts.filter((a) => a.domain !== state.site.domain)];
    }
    state.adding = false;
    state.screen = "scan";
  } catch {
    state.adding = false;
    state.screen = "error";
  }
  render();
}

async function removeAccount(domain) {
  const acct = state.accounts.find((a) => a.domain === domain);
  state.confirming = null;
  try {
    if (isExtension && acct && acct.connectionId) {
      await deleteConnection(acct.connectionId);
      state.accounts = (await listConnections()).map(toAccount);
    } else {
      state.accounts = state.accounts.filter((a) => a.domain !== domain);
    }
  } catch {
    // Leave the list as-is on failure; the next open re-syncs.
  }
  render();
}

function bind() {
  document.querySelectorAll("#body [data-act], #foot [data-act]").forEach((el) => {
    const act = el.dataset.act;
    el.addEventListener("click", () => {
      if (act === "add") startAdd();
      else if (act === "retry") init();
      else if (act === "manage") { state.screen = "manage"; render(); }
      else if (act === "back") { state.screen = "home"; state.confirming = null; render(); }
      else if (act === "done") { state.screen = "home"; render(); }
      else if (act === "qr") { state.screen = "scan"; render(); }
      else if (act === "copy") copyNumber(el);
      else if (act === "ask") { state.confirming = el.dataset.domain; render(); }
      else if (act === "keep") { state.confirming = null; render(); }
      else if (act === "remove") removeAccount(el.dataset.domain);
    });
  });
}

async function copyNumber(btn) {
  if (!state.config) return;
  try { await navigator.clipboard.writeText(state.config.phone); } catch {}
  btn.innerHTML = ic.copied;
  setTimeout(() => { btn.innerHTML = ic.copy; }, 1600);
}

async function init() {
  state.offline = false;
  if (isExtension) {
    // Show the number instantly from the last known config, then refresh.
    try {
      const cached = (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
      if (cached) state.config = cached;
    } catch {}
    // config is the reachability probe: if it fails and we have nothing cached,
    // treat the backend as down.
    try {
      state.config = await getConfig();
      chrome.storage.local.set({ [CONFIG_KEY]: state.config }).catch(() => {});
    } catch {
      if (!state.config) {
        state.offline = true;
        render();
        return;
      }
    }
    try { state.accounts = (await listConnections()).map(toAccount); } catch {}
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.site = siteFromTab(tab);
  } else {
    // Design preview: a connectable site that isn't yet connected, with config
    // already loaded. A URL hash forces a screen for design review.
    state.config = { phone: "+16175550142", smsLink: "sms:+16175550142" };
    state.site = { domain: "verizon.com", name: "Verizon", letter: "V", color: "#c62a1f", favIconUrl: "", url: "https://verizon.com", title: "Verizon" };
    state.accounts = mockAccounts();
    const h = location.hash.slice(1);
    if (h === "nosite") state.site = null;
    else if (h === "empty") state.accounts = [];
    else if (h === "added") state.accounts = [siteAsAccount(state.site), ...state.accounts];
    else if (h === "error") state.screen = "error";
    else if (h === "manage") state.screen = "manage";
    else if (h === "offline") { state.offline = true; state.config = null; }
  }
  render();
}

init();
