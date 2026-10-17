import { appendFileSync } from "node:fs";
import { CdpClient } from "../browser/cdp.js";

const MAX_BODY_BYTES = 200 * 1024;
const LOGGED_TYPES = new Set(["XHR", "Fetch", "Document"]);

interface RequestInfo {
  method: string;
  url: string;
  headers: Record<string, string>;
  postData: string | null;
}

function truncate(text: string | null): { text: string | null; truncated: boolean } {
  if (text === null) return { text: null, truncated: false };
  if (Buffer.byteLength(text) <= MAX_BODY_BYTES) return { text, truncated: false };
  return { text: Buffer.from(text).subarray(0, MAX_BODY_BYTES).toString(), truncated: true };
}

/**
 * Records XHR, Fetch and Document traffic of every page in the browser to `outFile`
 * (one JSON line per response). Returns a function that stops recording.
 */
export async function startNetworkLog(cdpUrl: string, outFile: string): Promise<() => void> {
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
    });
  });

  const responses = new Map<string, { status: number; mimeType: string; type: string }>();
  cdp.on("Network.responseReceived", (p, sid) => {
    responses.set(`${sid}:${p.requestId}`, { status: p.response?.status, mimeType: p.response?.mimeType, type: p.type });
  });

  cdp.on("Network.loadingFinished", (p, sid) => {
    const key = `${sid}:${p.requestId}`;
    const request = requests.get(key);
    const response = responses.get(key);
    requests.delete(key);
    responses.delete(key);
    if (stopped || !request || !response || !LOGGED_TYPES.has(response.type)) return;
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
