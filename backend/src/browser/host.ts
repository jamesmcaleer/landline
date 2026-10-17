import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

export interface BrowserHost {
  start(connectionId: string): Promise<{ cdpUrl: string }>;
  stop(connectionId: string): Promise<void>;
}

interface RunningBrowser {
  process: ChildProcess;
  userDataDir: string;
}

const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/\S+)/;
const START_TIMEOUT_MS = 30_000;

/** Spawns one headful Chromium per connection and reads its CDP URL from stderr. */
class LocalHost implements BrowserHost {
  private running = new Map<string, RunningBrowser>();

  async start(connectionId: string): Promise<{ cdpUrl: string }> {
    const userDataDir = await mkdtemp(join(tmpdir(), `landline-${connectionId}-`));
    const child = spawn(
      chromium.executablePath(),
      [
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    this.running.set(connectionId, { process: child, userDataDir });

    try {
      const cdpUrl = await readCdpUrl(child);
      return { cdpUrl };
    } catch (err) {
      await this.stop(connectionId);
      throw err;
    }
  }

  async stop(connectionId: string): Promise<void> {
    const browser = this.running.get(connectionId);
    if (!browser) return;
    this.running.delete(connectionId);
    browser.process.kill();
    await rm(browser.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function readCdpUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timer = setTimeout(() => fail(new Error("Chromium did not report a DevTools URL in time")), START_TIMEOUT_MS);

    function cleanup(): void {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
    }
    function fail(err: Error): void {
      cleanup();
      reject(err);
    }
    function onData(chunk: Buffer): void {
      buffered += chunk.toString();
      const match = DEVTOOLS_LINE.exec(buffered);
      if (match?.[1]) {
        cleanup();
        resolve(match[1]);
      }
    }
    function onExit(code: number | null): void {
      fail(new Error(`Chromium exited early with code ${code}`));
    }

    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

/** Uses a Chromium somebody else runs. Every connection shares it. */
class RemoteHost implements BrowserHost {
  async start(): Promise<{ cdpUrl: string }> {
    const cdpUrl = process.env.CDP_URL;
    if (!cdpUrl) throw new Error("CDP_URL is not set but BROWSER_HOST=remote");
    return { cdpUrl };
  }

  async stop(): Promise<void> {}
}

let host: BrowserHost | undefined;

export function getHost(): BrowserHost {
  host ??= process.env.BROWSER_HOST === "remote" ? new RemoteHost() : new LocalHost();
  return host;
}
