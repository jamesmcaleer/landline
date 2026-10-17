// Captures the active tab's logged-in session into the JSON shape described in
// SESSION_FORMAT.md. Runs from the popup, which has the cookies + scripting
// permissions. Nothing here is site-specific.

const FORMAT_VERSION = 1;

// Chrome reports sameSite as "no_restriction" | "lax" | "strict" | "unspecified".
// Normalize to the values SESSION_FORMAT.md documents.
function normalizeSameSite(value) {
  switch (value) {
    case "strict":
      return "Strict";
    case "lax":
      return "Lax";
    case "no_restriction":
      return "None";
    default:
      return "Lax"; // "unspecified" / unknown: Lax is Chrome's effective default
  }
}

function toExportCookie(c) {
  const out = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: normalizeSameSite(c.sameSite),
    hostOnly: c.hostOnly,
    session: c.session,
  };
  if (!c.session && typeof c.expirationDate === "number") {
    out.expirationDate = c.expirationDate;
  }
  return out;
}

// Reads localStorage + sessionStorage from inside the page. Returned to the
// extension as a plain object. Injected via chrome.scripting, so it runs in the
// page's own context where web storage lives.
function readWebStorageInPage() {
  const dump = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      out[key] = store.getItem(key);
    }
    return out;
  };
  return {
    origin: window.location.origin,
    localStorage: dump(window.localStorage),
    sessionStorage: dump(window.sessionStorage),
    // Collected here so the values come from the page itself, not the extension.
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      screen: { width: window.screen.width, height: window.screen.height },
    },
  };
}

// Builds the full session export for the given tab.
export async function captureSession(tab) {
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    throw new Error("Open a normal website tab you're signed into, then try again.");
  }

  const url = new URL(tab.url);

  // Cookies for the whole registrable domain, not just the exact host, so login
  // subdomains (login.*, auth.*) come along. getAll with a bare domain returns
  // that domain and its subdomains.
  const cookies = await chrome.cookies.getAll({ domain: url.hostname });

  const [{ result: page }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: readWebStorageInPage,
  });

  return {
    formatVersion: FORMAT_VERSION,
    capturedAt: new Date().toISOString(),
    site: {
      url: tab.url,
      title: tab.title || "",
      domain: url.hostname,
    },
    browser: page.browser,
    cookies: cookies.map(toExportCookie),
    origins: [
      {
        origin: page.origin,
        localStorage: page.localStorage,
        sessionStorage: page.sessionStorage,
      },
    ],
  };
}
