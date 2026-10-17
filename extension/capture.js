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

// Reads everything that lives in the page's origin: web storage, IndexedDB, and
// the browser fingerprint. Injected via chrome.scripting, so it runs in the
// page's own context where this state lives. Async because IndexedDB is async.
async function readPageStateInPage() {
  const dumpWebStorage = (store) => {
    const out = {};
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      out[key] = store.getItem(key);
    }
    return out;
  };

  const reqToPromise = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  // Best-effort IndexedDB dump. Values are whatever structured-clone types the
  // app stored; JSON serialization keeps strings, numbers, booleans, plain
  // objects and arrays, and turns Dates into strings. Binary values (Blob,
  // ArrayBuffer) don't survive and are left out. Good enough for auth tokens,
  // which are almost always strings or plain objects.
  const readIndexedDB = async () => {
    if (!window.indexedDB || typeof indexedDB.databases !== "function") return [];
    let infos;
    try {
      infos = await indexedDB.databases();
    } catch {
      return [];
    }
    const dbs = [];
    for (const info of infos) {
      if (!info.name) continue;
      let db;
      try {
        db = await new Promise((resolve, reject) => {
          const req = indexedDB.open(info.name);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error("blocked"));
        });
      } catch {
        continue;
      }
      const storeNames = Array.from(db.objectStoreNames);
      const stores = [];
      if (storeNames.length) {
        const tx = db.transaction(storeNames, "readonly");
        for (const name of storeNames) {
          const os = tx.objectStore(name);
          let keys, values;
          try {
            [keys, values] = await Promise.all([
              reqToPromise(os.getAllKeys()),
              reqToPromise(os.getAll()),
            ]);
          } catch {
            continue;
          }
          const records = values.map((value, i) => ({ key: keys[i], value }));
          stores.push({
            name,
            keyPath: os.keyPath, // string | string[] | null
            autoIncrement: os.autoIncrement,
            records,
          });
        }
      }
      dbs.push({ name: db.name, version: db.version, stores });
      db.close();
    }
    return dbs;
  };

  return {
    origin: window.location.origin,
    localStorage: dumpWebStorage(window.localStorage),
    sessionStorage: dumpWebStorage(window.sessionStorage),
    indexedDB: await readIndexedDB(),
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
    func: readPageStateInPage,
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
        indexedDB: page.indexedDB,
      },
    ],
  };
}
