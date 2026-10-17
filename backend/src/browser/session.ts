import { chromium } from "playwright";
import type { Cookie, SessionExport } from "@landline/shared";

const LOGIN_URL_HINTS = ["login", "signin", "sign-in", "auth"];

// Same mapping as toPlaywrightCookie in tools/replay/replay.mjs.
function toPlaywrightCookie(c: Cookie) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: typeof c.expirationDate === "number" ? c.expirationDate : -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite === "None" ? ("None" as const) : c.sameSite === "Strict" ? ("Strict" as const) : ("Lax" as const),
  };
}

/**
 * Loads a captured session into the Chromium at `cdpUrl` and opens the saved page.
 * Returns whether the site still looks logged in. The browser stays open.
 */
export async function loadSession(cdpUrl: string, session: SessionExport): Promise<boolean> {
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());

    await context.addCookies(session.cookies.map(toPlaywrightCookie));

    // sessionStorage must be set before page scripts run, per origin.
    for (const o of session.origins) {
      if (Object.keys(o.sessionStorage).length > 0) {
        await context.addInitScript(
          (entries: { origin: string; values: Record<string, string> }) => {
            if (window.location.origin === entries.origin) {
              for (const [k, v] of Object.entries(entries.values)) {
                window.sessionStorage.setItem(k, v);
              }
            }
          },
          { origin: o.origin, values: o.sessionStorage },
        );
      }
    }

    const page = context.pages()[0] ?? (await context.newPage());

    // localStorage can only be written from a page on the same origin.
    for (const o of session.origins) {
      if (Object.keys(o.localStorage).length === 0) continue;
      try {
        await page.goto(o.origin, { waitUntil: "domcontentloaded", timeout: 20_000 });
        await page.evaluate((values: Record<string, string>) => {
          for (const [k, v] of Object.entries(values)) window.localStorage.setItem(k, v);
        }, o.localStorage);
      } catch (err) {
        console.error(`Could not set localStorage for ${o.origin}:`, err);
      }
    }

    try {
      await page.goto(session.site.url, { waitUntil: "networkidle", timeout: 20_000 });
    } catch (err) {
      console.error(`Navigation to ${session.site.url} did not go idle:`, err instanceof Error ? err.message : err);
    }

    const finalUrl = page.url().toLowerCase();
    return !LOGIN_URL_HINTS.some((hint) => finalUrl.includes(hint));
  } finally {
    // Disconnects the Playwright client only; the browser keeps running.
    await browser.close();
  }
}
