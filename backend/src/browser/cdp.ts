// A minimal raw CDP client: send commands, subscribe to events, attach to a page target.

import WebSocket from "ws";

const COMMAND_TIMEOUT_MS = 30_000;

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  sessionId?: string;
  result?: Record<string, unknown>;
  error?: { message: string };
}

export type CdpEventHandler = (params: Record<string, any>, sessionId: string | undefined) => void;

export class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, Set<CdpEventHandler>>();
  private closeListeners = new Set<() => void>();

  private constructor(private ws: WebSocket) {
    ws.on("message", (data) => this.onMessage(JSON.parse(data.toString()) as CdpMessage));
    ws.on("close", () => {
      this.failAll(new Error("CDP connection closed"));
      for (const fn of this.closeListeners) fn();
    });
    ws.on("error", () => {});
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: false });
      ws.once("open", () => resolve(new CdpClient(ws)));
      ws.once("error", reject);
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, any>> {
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

  /** Subscribes to a CDP event (any session). Returns an unsubscribe function. */
  on(method: string, handler: CdpEventHandler): () => void {
    let set = this.handlers.get(method);
    if (!set) this.handlers.set(method, (set = new Set()));
    set.add(handler);
    return () => set.delete(handler);
  }

  onClose(fn: () => void): void {
    this.closeListeners.add(fn);
  }

  /** Resolves true when the event arrives for `sessionId`, false after `timeoutMs`. */
  waitForEvent(method: string, sessionId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const finish = (arrived: boolean) => {
        clearTimeout(timer);
        off();
        resolve(arrived);
      };
      const off = this.on(method, (_p, sid) => {
        if (sid === sessionId) finish(true);
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  /** Attaches (flatten) to the first page target, creating one if none exists. Returns the session id. */
  async attachToPage(): Promise<string> {
    const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Array<{ type: string; targetId: string }> };
    let targetId = targetInfos.find((t) => t.type === "page")?.targetId;
    if (!targetId) {
      targetId = ((await this.send("Target.createTarget", { url: "about:blank" })) as { targetId: string }).targetId;
    }
    const { sessionId } = (await this.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    return sessionId;
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
    if (!message.method) return;
    for (const handler of [...(this.handlers.get(message.method) ?? [])]) {
      try {
        handler(message.params ?? {}, message.sessionId);
      } catch (err) {
        console.error(`CDP handler for ${message.method} threw:`, err);
      }
    }
  }

  private failAll(err: Error): void {
    for (const entry of this.pending.values()) entry.reject(err);
    this.pending.clear();
  }
}
