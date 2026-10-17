import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dropToken, registerToken, waitForRelay } from "./relay-hub.js";
import type { BrowserProvider, StartedBrowser } from "./provider.js";

const SANDBOX_DIR = fileURLToPath(new URL("../../sandbox/", import.meta.url));
const PYTHON = join(SANDBOX_DIR, ".venv/bin/python");
const CTL = join(SANDBOX_DIR, "sandbox_ctl.py");
const RELAY_TIMEOUT_MS = 180_000;
const CTL_TIMEOUT_MS = 600_000;

/** Runs sandbox_ctl.py with the venv python. The Chalk CLI login supplies the credentials. */
function ctl(...args: string[]): Promise<string> {
  if (!existsSync(PYTHON)) return Promise.reject(new Error("Chalk helper not set up: run backend/scripts/setup-chalk.sh"));
  const env = { ...process.env, PATH: `${join(homedir(), ".chalk/bin")}${delimiter}${process.env.PATH ?? ""}` };
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [CTL, ...args], { env, timeout: CTL_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`sandbox_ctl ${args[0]} failed: ${stderr.trim() || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

function publicWsBase(): string {
  const port = Number(process.env.PORT ?? 3000);
  const base = (process.env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "");
  return base.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

function cdpUrlFor(connectionId: string): string {
  return `ws://127.0.0.1:${Number(process.env.PORT ?? 3000)}/cdp/${connectionId}`;
}

/**
 * One Chalk sandbox per connection. Chromium runs inside it, and a relay in the sandbox dials this
 * backend (sandbox/relay.py). `cdpUrl` is a ws:// URL served by relay-hub that pipes CDP through it.
 */
export class ChalkProvider implements BrowserProvider {
  private sandboxes = new Map<string, string>(); // connectionId -> sandbox name

  async start(connectionId: string): Promise<StartedBrowser> {
    const token = randomBytes(32).toString("hex");
    registerToken(connectionId, token);
    try {
      const wsUrl = `${publicWsBase()}/ws/sandbox/${connectionId}`;
      const out = await ctl("start", connectionId, wsUrl, token);
      const { name } = JSON.parse(out.split("\n").pop() ?? "{}") as { name?: string };
      if (!name) throw new Error(`sandbox_ctl start printed no sandbox name: ${out}`);
      this.sandboxes.set(connectionId, name);
      await waitForRelay(connectionId, RELAY_TIMEOUT_MS);
      return { cdpUrl: cdpUrlFor(connectionId), sandboxName: name, sandboxToken: token };
    } catch (err) {
      await this.stop(connectionId).catch(() => {});
      throw err;
    }
  }

  /** Reattaches to a sandbox created before a backend restart: its relay redials with the saved token. */
  async resume(connectionId: string, sandboxName: string, token: string): Promise<StartedBrowser> {
    registerToken(connectionId, token);
    this.sandboxes.set(connectionId, sandboxName);
    await waitForRelay(connectionId, RELAY_TIMEOUT_MS);
    return { cdpUrl: cdpUrlFor(connectionId), sandboxName, sandboxToken: token };
  }

  async stop(connectionId: string): Promise<void> {
    const name = this.sandboxes.get(connectionId);
    this.sandboxes.delete(connectionId);
    dropToken(connectionId);
    if (name) await ctl("stop", name);
  }
}
