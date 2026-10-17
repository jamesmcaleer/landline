// Loads a captured session into a Chromium over raw CDP.
//
// Playwright is not used here on purpose. A Playwright client has to stay
// connected, because its init scripts and context settings disappear when it
// disconnects, and it also assumes a local-style browser. Raw CDP lets us
// register the storage script on the page target itself, so it lasts as long as
// the page does, and it works the same through any provider that gives us a
// ws:// URL (including a relay).

import WebSocket from "ws";
import type { Cookie, SessionExport } from "@landline/shared";

const LOGIN_URL_HINTS = ["login", "signin", "sign-in", "auth"];
const COMMAND_TIMEOUT_MS = 30_000;
const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_000;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** A minimal CDP client: send commands, wait for events. */
class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private eventWaiters: Array<{ method: string; sessionId?: string; resolve: () => void }> = [];

  private constructor(private ws: WebSocket) {
    ws.on("message", (data) => this.onMessage(JSON.parse(data.toString()) as CdpMessage));
    ws.on("close", () => this.failAll(new Error("CDP connection closed")));
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      ws.once("open", () => resolve(new CdpClient(ws)));
      ws.once("error", reject);
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Resolves true when the event arrives, false after `timeoutMs`. */
  waitForEvent(method: string, sessionId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const waiter = { method, sessionId, resolve: () => finish(true) };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (arrived: boolean) => {
        clearTimeout(timer);
        this.eventWaiters = this.eventWaiters.filter((w) => w !== waiter);
        resolve(arrived);
      };
      this.eventWaiters.push(waiter);
    });
  }

  close(): void {
    this.ws.close();
  }

  private onMessage(message: CdpMessage): void {
    if (message.id !== undefined) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result ?? {});
      return;
    }
    for (const waiter of [...this.eventWaiters]) {
      if (waiter.method === message.method && waiter.sessionId === message.sessionId) waiter.resolve();
    }
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }
}

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
    const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: Array<{ type: string; targetId: string }> };
    let targetId = targetInfos.find((t) => t.type === "page")?.targetId;
    if (!targetId) {
      targetId = ((await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string }).targetId;
    }
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
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
