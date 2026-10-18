// Streams a live JPEG screencast of each connection's browser to the dashboard sockets.

import { CdpClient } from "../browser/cdp.js";
import { broadcastDashboard, hasDashboardClients, setLastFrame } from "../routes/events.js";

const MIN_FRAME_GAP_MS = 200; // at most 5 frames/s
const RETRY_MS = 2_000;

interface Active {
  stopped: boolean;
  cdp: CdpClient | null;
}
const active = new Map<string, Active>();

/** Starts (or restarts) the screencast for a connection. It reconnects by itself if the CDP link drops. */
export function startScreencast(connectionId: string, cdpUrl: string): void {
  stopScreencast(connectionId);
  const state: Active = { stopped: false, cdp: null };
  active.set(connectionId, state);
  void run(connectionId, cdpUrl, state);
}

export function stopScreencast(connectionId: string): void {
  const state = active.get(connectionId);
  if (!state) return;
  state.stopped = true;
  state.cdp?.close();
  active.delete(connectionId);
  setLastFrame(connectionId, null);
}

async function run(connectionId: string, cdpUrl: string, state: Active): Promise<void> {
  while (!state.stopped) {
    try {
      await session(connectionId, cdpUrl, state);
    } catch (err) {
      if (!state.stopped) console.error(`Screencast for ${connectionId}:`, err instanceof Error ? err.message : err);
    }
    if (state.stopped) return;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

/** One CDP connection's worth of screencasting. Resolves when the connection closes. */
async function session(connectionId: string, cdpUrl: string, state: Active): Promise<void> {
  const cdp = await CdpClient.connect(cdpUrl);
  state.cdp = cdp;
  if (state.stopped) {
    cdp.close();
    return;
  }
  const closed = new Promise<void>((resolve) => cdp.onClose(resolve));

  const pages: string[] = []; // page target ids, oldest first
  let current: { targetId: string; sessionId: string } | null = null;
  let lastSent = 0;
  let switching = Promise.resolve();

  async function attach(targetId: string): Promise<void> {
    if (current?.targetId === targetId) return;
    if (current) {
      const old = current;
      current = null;
      await cdp.send("Page.stopScreencast", {}, old.sessionId).catch(() => {});
      await cdp.send("Target.detachFromTarget", { sessionId: old.sessionId }).catch(() => {});
    }
    const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    current = { targetId, sessionId };
    await cdp.send("Page.enable", {}, sessionId).catch(() => {});
    await cdp.send(
      "Page.startScreencast",
      { format: "jpeg", quality: 55, maxWidth: 960, maxHeight: 600, everyNthFrame: 2 },
      sessionId,
    );
  }
  const queue = (fn: () => Promise<void>) => {
    switching = switching.then(fn).catch((err) => console.error("Screencast switch failed:", err instanceof Error ? err.message : err));
  };

  cdp.on("Page.screencastFrame", (params, sessionId) => {
    // Ack every frame so Chromium keeps sending; only forward some of them.
    void cdp.send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId).catch(() => {});
    if (sessionId !== current?.sessionId) return;
    const now = Date.now();
    if (now - lastSent < MIN_FRAME_GAP_MS) return;
    lastSent = now;
    const frame = { type: "frame" as const, connectionId, jpeg: String(params.data) };
    setLastFrame(connectionId, frame);
    if (hasDashboardClients()) broadcastDashboard(frame);
  });

  const consider = (info: { targetId: string; type: string }) => {
    if (info.type !== "page") return;
    if (!pages.includes(info.targetId)) {
      pages.push(info.targetId);
      queue(() => attach(info.targetId)); // follow the newest page
    }
  };
  cdp.on("Target.targetCreated", (p) => consider(p.targetInfo));
  cdp.on("Target.targetInfoChanged", (p) => consider(p.targetInfo));
  cdp.on("Target.targetDestroyed", (p) => {
    const i = pages.indexOf(p.targetId);
    if (i >= 0) pages.splice(i, 1);
    if (current?.targetId === p.targetId) {
      current = null;
      const next = pages[pages.length - 1];
      if (next) queue(() => attach(next));
    }
  });

  await cdp.send("Target.setDiscoverTargets", { discover: true });
  // targetCreated events for existing targets arrive after setDiscoverTargets; if there are none, make a page.
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (pages.length === 0) await cdp.send("Target.createTarget", { url: "about:blank" });
  await closed;
}
