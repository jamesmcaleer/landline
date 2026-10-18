import { appendFileSync } from "node:fs";
import type { NetworkFrame } from "@landline/shared";
import { CdpClient } from "../browser/cdp.js";
import { broadcastDashboard, hasDashboardClients } from "../routes/events.js";

const MAX_BODY_BYTES = 200 * 1024;
const LOGGED_TYPES = new Set(["XHR", "Fetch", "Document"]);

interface RequestInfo {
  method: string;
  url: string;
  headers: Record<string, string>;
  postData: string | null;
  startedAt: number; // CDP monotonic seconds
}

function truncate(text: string | null): { text: string | null; truncated: boolean } {
  if (text === null) return { text: null, truncated: false };
  if (Buffer.byteLength(text) <= MAX_BODY_BYTES) return { text, truncated: false };
  return { text: Buffer.from(text).subarray(0, MAX_BODY_BYTES).toString(), truncated: true };
}

/** Milliseconds between two CDP timing offsets, 0 when either is missing (-1) or the span is negative. */
function span(start: number | undefined, end: number | undefined): number {
  if (start === undefined || end === undefined || start < 0 || end < 0) return 0;
  return Math.max(0, Math.round(end - start));
}

/** Phase durations. CDP timing offsets are ms relative to t.requestTime (seconds); finishedAt is CDP seconds. */
function toTiming(t: any, finishedAt: number): NetworkFrame["timing"] {
  if (!t) return null;
  return {
    dns: span(t.dnsStart, t.dnsEnd),
    connect: span(t.connectStart, t.connectEnd),
    tls: span(t.sslStart, t.sslEnd),
    wait: span(t.sendEnd, t.receiveHeadersEnd),
    download: t.receiveHeadersEnd >= 0 ? Math.max(0, Math.round((finishedAt - t.requestTime) * 1000 - t.receiveHeadersEnd)) : 0,
  };
}

/**
 * Records XHR, Fetch and Document traffic of every page in the browser to `outFile`
 * (one JSON line per response). Every finished request of any type is also sent to the
 * dashboard as a NetworkFrame. Returns a function that stops recording.
 */
export async function startNetworkLog(cdpUrl: string, outFile: string, connectionId: string): Promise<() => void> {
  const cdp = await CdpClient.connect(cdpUrl);
  const requests = new Map<string, RequestInfo>(); // key: sessionId + requestId
  const attached = new Set<string>(); // target ids
  let stopped = false;

  const attach = async (targetId: string): Promise<void> => {
    if (attached.has(targetId)) return;
    attached.add(targetId);
    try {
      const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
      await cdp.send("Network.enable", {}, sessionId);
    } catch (err) {
      attached.delete(targetId);
      console.error("Network log could not attach:", err instanceof Error ? err.message : err);
    }
  };

  cdp.on("Network.requestWillBeSent", (p, sid) => {
    requests.set(`${sid}:${p.requestId}`, {
      method: p.request?.method,
      url: p.request?.url,
      headers: p.request?.headers ?? {},
      postData: p.request?.postData ?? null,
      startedAt: p.timestamp,
    });
  });

  const responses = new Map<string, { status: number; mimeType: string; type: string; timing: unknown }>();
  cdp.on("Network.responseReceived", (p, sid) => {
    responses.set(`${sid}:${p.requestId}`, { status: p.response?.status, mimeType: p.response?.mimeType, type: p.type, timing: p.response?.timing });
  });

  cdp.on("Network.loadingFinished", (p, sid) => {
    const key = `${sid}:${p.requestId}`;
    const request = requests.get(key);
    const response = responses.get(key);
    requests.delete(key);
    responses.delete(key);
    if (stopped || !request || !response) return;
    if (hasDashboardClients() && !request.url?.startsWith("data:")) {
      const ms = Math.max(0, Math.round((p.timestamp - request.startedAt) * 1000));
      const frame: NetworkFrame = {
        type: "net",
        connectionId,
        id: key,
        ts: new Date().toISOString(),
        method: request.method,
        url: request.url,
        status: response.status,
        resourceType: response.type,
        mimeType: response.mimeType,
        ms,
        size: p.encodedDataLength ?? 0,
        timing: toTiming(response.timing, p.timestamp),
      };
      broadcastDashboard(frame);
    }
    if (!LOGGED_TYPES.has(response.type)) return;
    void (async () => {
      let body: string | null = null;
      try {
        const r = (await cdp.send("Network.getResponseBody", { requestId: p.requestId }, sid)) as { body: string; base64Encoded: boolean };
        body = r.base64Encoded ? `[base64 ${r.body.length} chars]` : r.body;
      } catch {
        // Body not available (redirect, evicted, no content).
      }
      const res = truncate(body);
      const req = truncate(request.postData);
      const line = {
        ts: new Date().toISOString(),
        method: request.method,
        url: request.url,
        status: response.status,
        mimeType: response.mimeType,
        requestBody: req.text,
        responseBody: res.text,
        truncated: req.truncated || res.truncated,
      };
      try {
        appendFileSync(outFile, JSON.stringify(line) + "\n");
      } catch (err) {
        console.error("Network log write failed:", err);
      }
    })();
  });

  cdp.on("Target.targetCreated", (p) => {
    if (p.targetInfo?.type === "page") void attach(p.targetInfo.targetId);
  });
  await cdp.send("Target.setDiscoverTargets", { discover: true });
  const { targetInfos } = (await cdp.send("Target.getTargets")) as { targetInfos: Array<{ type: string; targetId: string }> };
  for (const t of targetInfos) if (t.type === "page") await attach(t.targetId);

  return () => {
    stopped = true;
    cdp.close();
  };
}
