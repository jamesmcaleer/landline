import type { BrowserProvider } from "./provider.js";

/** Opaque handle to one Chalk sandbox. Filled in when the provider is implemented. */
type SandboxHandle = unknown;

/**
 * Plan: each connection gets its own Chalk sandbox, created with the Python
 * `chalkcompute` SDK. Chromium runs inside the sandbox and dials an outbound
 * websocket relay to this backend. `cdpUrl` is a ws:// URL served by this
 * backend that forwards CDP traffic through that relay. `stop` terminates the sandbox.
 */
export class ChalkProvider implements BrowserProvider {
  private sandboxes = new Map<string, SandboxHandle>();

  async start(_connectionId: string): Promise<{ cdpUrl: string }> {
    throw new Error("ChalkProvider not implemented yet");
  }

  async stop(connectionId: string): Promise<void> {
    this.sandboxes.delete(connectionId);
  }
}
