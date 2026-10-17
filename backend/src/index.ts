import "dotenv/config";
import http from "node:http";
import express from "express";
import { actionsRouter } from "./routes/actions.js";
import { approvalsRouter, startExpiryTimer } from "./routes/approvals.js";
import { connectionsRouter } from "./routes/connections.js";
import { dashboardServer, eventsRouter } from "./routes/events.js";
import { getProvider } from "./browser/provider.js";
import { loadSession } from "./browser/session.js";
import { startScreencast } from "./agent/screencast.js";
import { handleHubUpgrade, onAnyRelayConnected, relayRouter } from "./browser/relay-hub.js";
import { onRelayReconnected, resolveApproval } from "./services.js";
import { approvals, connections, load, save } from "./store.js";

load();
await rehydrateConnections();

/** Stored connections lost their browsers on restart. Start new ones and replay the saved sessions. */
async function rehydrateConnections(): Promise<void> {
  for (const connection of [...connections.values()]) {
    try {
      if (!connection.session) throw new Error("no saved session");
      const provider = getProvider();
      if (connection.sandboxName && connection.sandboxToken && provider.resume) {
        // The sandbox outlived us: wait for its relay to redial, then reload the session (its profile may be wiped).
        ({ cdpUrl: connection.cdpUrl } = await provider.resume(connection.id, connection.sandboxName, connection.sandboxToken));
      } else {
        const started = await provider.start(connection.id);
        connection.cdpUrl = started.cdpUrl;
        connection.sandboxName = started.sandboxName;
        connection.sandboxToken = started.sandboxToken;
      }
      connection.loggedIn = await loadSession(connection.cdpUrl, connection.session);
      startScreencast(connection.id, connection.cdpUrl);
      console.log(`Restored connection ${connection.id} (${connection.site.domain})`);
    } catch (err) {
      console.error(`Dropping connection ${connection.id}:`, err instanceof Error ? err.message : err);
      for (const approval of approvals.values()) {
        if (approval.connectionId === connection.id) resolveApproval(approval.id, "declined", "connection removed");
      }
      await getProvider().stop(connection.id).catch(() => {});
      connections.delete(connection.id);
    }
  }
  save();
}

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(connectionsRouter);
app.use(approvalsRouter);
app.use(actionsRouter);
app.use(eventsRouter);
app.use(relayRouter);

const server = http.createServer(app);
server.on("upgrade", (request, socket, head) => {
  const path = new URL(request.url ?? "", "http://localhost").pathname;
  if (path === "/ws/dashboard") dashboardServer.handleUpgrade(request, socket, head, (ws) => dashboardServer.emit("connection", ws, request));
  else if (!handleHubUpgrade(request, socket, head)) socket.destroy();
});
// A restarted sandbox has an empty profile, so reload the saved session whenever its relay redials.
onAnyRelayConnected(onRelayReconnected);
startExpiryTimer();

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Landline backend listening on port ${port}`);
});
