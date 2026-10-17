import "dotenv/config";
import http from "node:http";
import express from "express";
import { approvalsRouter, startExpiryTimer } from "./routes/approvals.js";
import { connectionsRouter } from "./routes/connections.js";
import { attachDashboardSocket, eventsRouter } from "./routes/events.js";
import { load } from "./store.js";

load();

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(connectionsRouter);
app.use(approvalsRouter);
app.use(eventsRouter);

const server = http.createServer(app);
attachDashboardSocket(server);
startExpiryTimer();

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => {
  console.log(`Landline backend listening on port ${port}`);
});
