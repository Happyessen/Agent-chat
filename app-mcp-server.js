// app-mcp-server.js — OpenAI Apps SDK MCP Server
// Follows OpenAI's Apps SDK quickstart pattern
// Install: npm install
// Run:     node app-mcp-server.js

import { createServer } from "node:http";
import "dotenv/config";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Configuration
const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:3001";
const PORT = process.env.MCP_PORT ?? 8787;
const MCP_PATH = "/mcp";

// Input schemas for tools
const sendMessageSchema = {
  message: z.string().min(1, "Message cannot be empty"),
  session_id: z.string().optional(),
};

// ── Tool Functions ────────────────────────────────────────────────────────────

async function callAgent(message, sessionId) {
  const url = new URL("/chat", AGENT_API);
  const sessionId_ = sessionId ?? `session_${Date.now()}`;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: message }],
      session_id: sessionId_,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Agent API error ${response.status}: ${await response.text()}`
    );
  }

  // Collect streamed response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "text" && data.content) {
            fullText += data.content;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  return {
    message: fullText || "No response from agent",
    session_id: sessionId_,
  };
}

async function checkHealth() {
  const url = new URL("/health", AGENT_API);

  try {
    const response = await fetch(url.toString(), { timeout: 5000 });
    const data = await response.json();
    return {
      status: "online",
      details: data,
    };
  } catch (err) {
    return {
      status: "offline",
      error: err.message,
    };
  }
}

// ── Create MCP Server ─────────────────────────────────────────────────────────

function createAppServer() {
  const server = new McpServer(
    { name: "agent-chat-app", version: "1.0.0" },
    { capabilities: {} }
  );

  // ── Register Tools (callable by ChatGPT) ──────────────────────────────────

  registerAppTool(
    server,
    "send_message",
    {
      title: "Send Message to Agent",
      description:
        "Send a message to your n8n agent and get a formatted response. Use this for campaign analysis, data retrieval, and complex queries.",
      inputSchema: sendMessageSchema,
    },
    async (args) => {
      const message = args?.message;
      if (!message) {
        return {
          content: [{ type: "text", text: "Error: Message is required" }],
        };
      }

      try {
        const result = await callAgent(message, args?.session_id);
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: result,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  registerAppTool(
    server,
    "check_agent_health",
    {
      title: "Check Agent Health",
      description: "Check if the agent service is online and responding",
      inputSchema: {},
    },
    async () => {
      try {
        const health = await checkHealth();
        const message =
          health.status === "online"
            ? `Agent is online - Status: ${JSON.stringify(health.details)}`
            : `Agent is offline - Error: ${health.error}`;

        return {
          content: [{ type: "text", text: message }],
          structuredContent: health,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Health check failed: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // ── Register UI Resource (optional web component) ────────────────────────

  registerAppResource(
    server,
    "agent-ui",
    "ui://agent/dashboard.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://agent/dashboard.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Chat Dashboard</title>
  <style>
    :root {
      color: #0b0b0f;
      font-family: "Inter", system-ui, -apple-system, sans-serif;
    }
    html, body {
      width: 100%;
      min-height: 100%;
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #f6f8fb;
      padding: 16px;
    }
    main {
      width: 100%;
      max-width: 500px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.08);
    }
    h1 {
      margin: 0 0 24px;
      font-size: 1.5rem;
      color: #0b0b0f;
    }
    .status {
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.95rem;
    }
    .status.online {
      background: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #4caf50;
    }
    .status.offline {
      background: #ffebee;
      color: #c62828;
      border: 1px solid #f44336;
    }
    .info-box {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 8px;
      margin-top: 16px;
      font-size: 0.9rem;
      line-height: 1.6;
      color: #666;
    }
    button {
      background: #111bf5;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 10px 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      margin-top: 16px;
    }
    button:hover {
      background: #0d1ac9;
    }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <main>
    <h1>Agent Chat Dashboard</h1>
    <div id="status" class="status offline">Checking status...</div>
    <div class="info-box">
      <strong>Welcome!</strong> This is your agent chat interface. Use the tools available above to:
      <ul style="margin: 8px 0; padding-left: 20px;">
        <li>Send messages to your n8n agent</li>
        <li>Analyze campaigns and data</li>
        <li>Run complex queries</li>
      </ul>
    </div>
    <button id="refresh-btn" onclick="checkStatus()">Check Status</button>
  </main>

  <script type="module">
    let rpcId = 0;
    const pendingRequests = new Map();

    const rpcRequest = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++rpcId;
        pendingRequests.set(id, { resolve, reject });
        window.parent.postMessage(
          { jsonrpc: "2.0", id, method, params },
          "*"
        );
      });

    window.addEventListener("message", (event) => {
      if (event.source !== window.parent) return;
      const message = event.data;
      if (!message || message.jsonrpc !== "2.0") return;

      if (typeof message.id === "number") {
        const pending = pendingRequests.get(message.id);
        if (!pending) return;
        pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(message.error);
          return;
        }
        pending.resolve(message.result);
      }
    }, { passive: true });

    async function initializeBridge() {
      const appInfo = { name: "agent-chat-dashboard", version: "1.0.0" };
      const appCapabilities = {};
      const protocolVersion = "2026-01-26";

      try {
        await rpcRequest("ui/initialize", {
          appInfo,
          appCapabilities,
          protocolVersion,
        });
        window.parent.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/initialized",
          params: {},
        }, "*");
      } catch (error) {
        console.error("Failed to initialize bridge:", error);
      }
    }

    window.checkStatus = async function() {
      const btn = document.getElementById("refresh-btn");
      const statusDiv = document.getElementById("status");
      btn.disabled = true;
      btn.textContent = "Checking...";

      try {
        const result = await rpcRequest("tools/call", {
          name: "check_agent_health",
          arguments: {},
        });
        const status = result.structuredContent?.status || "unknown";
        statusDiv.className = "status " + (status === "online" ? "online" : "offline");
        statusDiv.textContent = status === "online"
          ? "✓ Agent is online and ready"
          : "✗ Agent is offline";
      } catch (error) {
        statusDiv.className = "status offline";
        statusDiv.textContent = "✗ Agent check failed: " + error.message;
      } finally {
        btn.disabled = false;
        btn.textContent = "Check Status";
      }
    };

    initializeBridge();
    window.checkStatus();
  </script>
</body>
</html>
`,
        },
      ],
    })
  );

  return server;
}

// ── HTTP Server Setup ─────────────────────────────────────────────────────────

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end("Missing URL");
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  // CORS for MCP endpoint
  if (req.method === "OPTIONS" && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, mcp-session-id",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    });
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() })
    );
    return;
  }

  // MCP endpoint
  const MCP_METHODS = new Set(["POST", "GET", "DELETE"]);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

    const server = createAppServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.writeHead(500).end("Internal server error");
      }
    }
    return;
  }

  // Root endpoint
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" }).end(
      "Agent Chat MCP Server - Available at /mcp"
    );
    return;
  }

  res.writeHead(404).end("Not Found");
});

httpServer.listen(PORT, () => {
  console.log(`✓ Agent Chat MCP Server listening on http://localhost:${PORT}${MCP_PATH}`);
  console.log(`✓ Health check: http://localhost:${PORT}/health`);
  console.log(`✓ Use this URL in ChatGPT: https://your-domain.com${MCP_PATH}`);
});
