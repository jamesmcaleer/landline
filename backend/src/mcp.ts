// MCP server for voice agent platforms (for example ElevenLabs Agents).
import { Router, type Request, type Response, type NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { peekAgent, sendAction, toPublicConnection, waitForTurnEvent } from "./services.js";
import { connections } from "./store.js";

export const mcpRouter = Router();

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "landline", version: "0.1.0" });

  server.registerTool(
    "list_connections",
    {
      description:
        "List the websites the caller's family connected. Pick the one the caller is talking about. state tells you if the agent is idle, working, waiting_approval, or waiting_user.",
      inputSchema: {},
    },
    async () =>
      text(
        [...connections.values()].map((c) => {
          const p = toPublicConnection(c);
          return { id: p.id, domain: p.site.domain, title: p.site.title, state: p.state, loggedIn: p.loggedIn, createdAt: p.createdAt };
        }),
      ),
  );

  server.registerTool(
    "send_action",
    {
      description:
        "Send the caller's request in plain English to the agent for one site. Returns at once. Then call wait_result until you get a result or an error. If the agent asked a question, send the caller's answer with this tool.",
      inputSchema: {
        connectionId: z.string().describe("The id from list_connections"),
        query: z.string().min(1).describe("The caller's request or answer, in plain English"),
      },
    },
    async ({ connectionId, query }) => {
      if (!connections.has(connectionId)) return text({ error: "connection not found" }, true);
      try {
        await sendAction(connectionId, query.trim());
      } catch (err) {
        if (err instanceof Error && err.message === "busy") return text({ error: "busy" }, true);
        if (err instanceof Error && err.message === "connection not found") return text({ error: "connection not found" }, true);
        console.error("MCP send_action failed:", err);
        return text({ error: "could not start agent" }, true);
      }
      return text({ accepted: true });
    },
  );

  server.registerTool(
    "wait_result",
    {
      description:
        "Wait up to 25 seconds for the agent's next update after send_action. Returns JSON with a kind. " +
        "result: the task is done; read the text back to the caller. " +
        "question: the agent needs more information; ask the caller, then send their answer with send_action. " +
        "approval: the action changes something on the site, so it needs the family member's approval on their phone; tell the caller that, and keep calling wait_result. " +
        "progress: optional check-in text about what the agent is doing; you may tell the caller, then call wait_result again. " +
        "error: it failed; say so plainly. " +
        "pending: nothing new yet; call wait_result again.",
      inputSchema: {
        connectionId: z.string().describe("The id from list_connections"),
        timeoutSeconds: z.number().min(1).max(25).optional().describe("Seconds to wait, default 25, maximum 25"),
      },
    },
    async ({ connectionId, timeoutSeconds }) => {
      if (!connections.has(connectionId)) return text({ error: "connection not found" }, true);
      const event = await waitForTurnEvent(connectionId, Math.min(timeoutSeconds ?? 25, 25) * 1000);
      return text(event ?? { kind: "pending" });
    },
  );

  server.registerTool(
    "stop_action",
    {
      description: "Stop the agent's current task for one site, for example when the caller changes their mind.",
      inputSchema: { connectionId: z.string().describe("The id from list_connections") },
    },
    async ({ connectionId }) => {
      if (!connections.has(connectionId)) return text({ error: "connection not found" }, true);
      await peekAgent(connectionId)?.stop();
      return text({ stopped: true });
    },
  );

  return server;
}

function requireToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.MCP_TOKEN;
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

mcpRouter.use("/mcp", requireToken);

mcpRouter.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
});

const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
mcpRouter.get("/mcp", methodNotAllowed);
mcpRouter.delete("/mcp", methodNotAllowed);

// Legacy SSE transport: GET /mcp/sse opens the stream, the client POSTs messages to /mcp/messages.
const sseTransports = new Map<string, SSEServerTransport>();

mcpRouter.get("/mcp/sse", requireToken, async (_req, res) => {
  const transport = new SSEServerTransport("/mcp/messages", res);
  sseTransports.set(transport.sessionId, transport);
  const server = createMcpServer();
  res.on("close", () => {
    sseTransports.delete(transport.sessionId);
    void server.close();
  });
  await server.connect(transport);
});

mcpRouter.post("/mcp/messages", requireToken, async (req, res) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const transport = sseTransports.get(sessionId);
  if (!transport) {
    res.status(400).json({ error: "unknown sessionId" });
    return;
  }
  await transport.handlePostMessage(req, res, req.body);
});
