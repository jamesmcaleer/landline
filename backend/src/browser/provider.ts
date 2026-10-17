import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { ChalkProvider } from "./chalk.js";

/** Gives each connection its own browser, reachable over CDP. */
export interface BrowserProvider {
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
export class LocalProvider implements BrowserProvider {
  private running = new Map<string, RunningBrowser>();

  constructor() {
    // Do not leave Chromium processes behind when the backend stops.
    process.on("exit", () => this.killAll());
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        this.killAll();
        process.exit(0);
      });
    }
  }

  private killAll(): void {
    for (const browser of this.running.values()) browser.process.kill();
  }

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

let provider: BrowserProvider | undefined;

/** Picks the provider from BROWSER_PROVIDER (local | chalk). Defaults to local. */
export function getProvider(): BrowserProvider {
  provider ??= process.env.BROWSER_PROVIDER === "chalk" ? new ChalkProvider() : new LocalProvider();
  return provider;
}
