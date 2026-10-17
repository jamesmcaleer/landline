// Loads a captured session into a Chromium over raw CDP.
//
// Playwright is not used here on purpose. A Playwright client has to stay
// connected, because its init scripts and context settings disappear when it
// disconnects, and it also assumes a local-style browser. Raw CDP lets us
// register the storage script on the page target itself, so it lasts as long as
// the page does, and it works the same through any provider that gives us a
// ws:// URL (including a relay).

import { CdpClient } from "./cdp.js";
import type { Cookie, SessionExport } from "@landline/shared";

const LOGIN_URL_HINTS = ["login", "signin", "sign-in", "auth"];
const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_000;

function toCdpCookie(c: Cookie) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    ...(typeof c.expirationDate === "number" ? { expires: c.expirationDate } : {}),
  };
}

/** Script that restores web storage on every new document of a matching origin. */
function storageScript(session: SessionExport): string {
  const origins = JSON.stringify(session.origins);
  return `(() => {
  const origins = ${origins};
  const entry = origins.find((o) => o.origin === location.origin);
  if (!entry) return;
  // Keys the page already has are newer than the capture, so leave them alone.
  const restore = (storage, values) => {
    for (const [k, v] of Object.entries(values)) {
      if (storage.getItem(k) === null) storage.setItem(k, v);
    }
  };
  try { restore(window.localStorage, entry.localStorage); } catch (e) {}
  try { restore(window.sessionStorage, entry.sessionStorage); } catch (e) {}
})();`;
}

async function tryCommand(label: string, command: Promise<unknown>): Promise<void> {
  try {
    await command;
  } catch (err) {
    console.error(`${label} failed:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Loads a captured session into the Chromium at `cdpUrl` and opens the saved page.
 * Returns whether the site still looks logged in. The browser stays open.
 */
export async function loadSession(cdpUrl: string, session: SessionExport): Promise<boolean> {
  const cdp = await CdpClient.connect(cdpUrl);
  try {
    const sessionId = await cdp.attachToPage();
    const page = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);

    await page("Network.enable");
    await page("Network.setCookies", { cookies: session.cookies.map(toCdpCookie) });

    const b = session.browser;
    await tryCommand("setUserAgentOverride", page("Emulation.setUserAgentOverride", { userAgent: b.userAgent, platform: b.platform }));
    await tryCommand("setTimezoneOverride", page("Emulation.setTimezoneOverride", { timezoneId: b.timezone }));
    await tryCommand("setLocaleOverride", page("Emulation.setLocaleOverride", { locale: b.language }));

    await page("Page.enable");
    await page("Page.addScriptToEvaluateOnNewDocument", { source: storageScript(session) });

    const loaded = cdp.waitForEvent("Page.loadEventFired", sessionId, LOAD_TIMEOUT_MS);
    await page("Page.navigate", { url: session.site.url });
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const evaluated = (await page("Runtime.evaluate", { expression: "location.href", returnByValue: true })) as {
      result: { value?: unknown };
    };
    const finalUrl = String(evaluated.result.value ?? "").toLowerCase();
    return !LOGIN_URL_HINTS.some((hint) => finalUrl.includes(hint));
  } finally {
    // Closes only our websocket; the browser and its page stay open.
    cdp.close();
  }
}
