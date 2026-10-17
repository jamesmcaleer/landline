import "dotenv/config";
import http from "node:http";
import express from "express";
import { actionsRouter } from "./routes/actions.js";
import { approvalsRouter, startExpiryTimer } from "./routes/approvals.js";
import { connectionsRouter } from "./routes/connections.js";
import { attachDashboardSocket, eventsRouter } from "./routes/events.js";
import { getProvider } from "./browser/provider.js";
import { loadSession } from "./browser/session.js";
import { resolveApproval } from "./services.js";
import { approvals, connections, load, save } from "./store.js";

load();
await rehydrateConnections();

/** Stored connections lost their browsers on restart. Start new ones and replay the saved sessions. */
async function rehydrateConnections(): Promise<void> {
  for (const connection of [...connections.values()]) {
    try {
      if (!connection.session) throw new Error("no saved session");
      ({ cdpUrl: connection.cdpUrl } = await getProvider().start(connection.id));
      connection.loggedIn = await loadSession(connection.cdpUrl, connection.session);
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

const server = http.createServer(app);
attachDashboardSocket(server);
startExpiryTimer();

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Landline backend listening on port ${port}`);
});
