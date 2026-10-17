// Local stand-in for the cloud browser. Loads a session captured by the
// extension, replays it into a fresh Chromium, opens the saved page, and
// screenshots it. If the screenshot shows you logged in, the capture format
// works end to end.
//
// Usage:
//   node replay.mjs <path-to-session.json> [output.png]
//
// Note: same machine + same IP, so this does NOT test bot detection. That is a
// cloud-side concern tested once the session service exists.

import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Runs in the page. Recreates each captured IndexedDB database, its object
// stores, and their records. Mirrors the capture in extension/capture.js.
function restoreIndexedDB(dbs) {
  const openDb = (spec) =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(spec.name, spec.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of spec.stores) {
          if (!db.objectStoreNames.contains(s.name)) {
            db.createObjectStore(s.name, {
              keyPath: s.keyPath === null ? undefined : s.keyPath,
              autoIncrement: s.autoIncrement,
            });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    });

  return (async () => {
    for (const spec of dbs) {
      const db = await openDb(spec);
      const names = spec.stores.map((s) => s.name).filter((n) => db.objectStoreNames.contains(n));
      if (names.length) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(names, "readwrite");
          for (const s of spec.stores) {
            if (!db.objectStoreNames.contains(s.name)) continue;
            const os = tx.objectStore(s.name);
            for (const rec of s.records) {
              // Inline key (keyPath set): the key lives in the value. Out-of-line
              // key: pass it explicitly.
              if (s.keyPath !== null) os.put(rec.value);
              else os.put(rec.value, rec.key);
            }
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      db.close();
    }
  })();
}

function toPlaywrightCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expirationDate === "number" ? c.expirationDate : -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite === "None" ? "None" : c.sameSite === "Strict" ? "Strict" : "Lax",
  };
}

async function main() {
  const [sessionPath, outPath = "replay.png"] = process.argv.slice(2);
  if (!sessionPath) {
    console.error("Usage: node replay.mjs <path-to-session.json> [output.png]");
    process.exit(1);
  }

  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  const b = session.browser || {};

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: b.userAgent,
    locale: b.language,
    timezoneId: b.timezone,
    viewport: b.screen ? { width: b.screen.width, height: b.screen.height } : undefined,
    // localStorage replays through storageState; cookies added below.
    storageState: {
      cookies: [],
      origins: (session.origins || []).map((o) => ({
        origin: o.origin,
        localStorage: Object.entries(o.localStorage || {}).map(([name, value]) => ({
          name,
          value,
        })),
      })),
    },
  });

  await context.addCookies(session.cookies.map(toPlaywrightCookie));

  // sessionStorage is not part of storageState, so set it before page scripts
  // run, per origin.
  for (const o of session.origins || []) {
    if (o.sessionStorage && Object.keys(o.sessionStorage).length > 0) {
      await context.addInitScript((entries) => {
        if (window.location.origin === entries.origin) {
          for (const [k, v] of Object.entries(entries.values)) {
            window.sessionStorage.setItem(k, v);
          }
        }
      }, { origin: o.origin, values: o.sessionStorage });
    }
  }

  const page = await context.newPage();

  // Restore IndexedDB per origin before loading the target page. We visit the
  // origin, write the databases, then navigate to the real URL so the page's
  // own scripts see a populated IndexedDB from the start.
  for (const o of session.origins || []) {
    if (!o.indexedDB || o.indexedDB.length === 0) continue;
    await page.goto(o.origin, { waitUntil: "domcontentloaded" });
    await page.evaluate(restoreIndexedDB, o.indexedDB);
  }

  await page.goto(session.site.url, { waitUntil: "networkidle" });
  await page.screenshot({ path: outPath, fullPage: true });

  console.log(`Replayed ${session.site.url}`);
  console.log(`  cookies: ${session.cookies.length}`);
  console.log(`  screenshot: ${outPath}`);
  console.log("Open the screenshot and check whether you are logged in.");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
