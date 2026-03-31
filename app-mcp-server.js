// app-mcp-server.js — OpenAI Apps SDK MCP Server
// Follows OpenAI's Apps SDK quickstart pattern
// Install: npm install
// Run:     node app-mcp-server.js

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:3001";
const PORT = process.env.MCP_PORT ?? 8787;
const MCP_PATH = "/mcp";

console.log("MCP server config:", { AGENT_API, PORT, MCP_PATH });

// Load campaign UI HTML
let campaignUIHtml = "";
try {
  const campaignUIPath = join(__dirname, "public", "campaign-ui.html");
  campaignUIHtml = readFileSync(campaignUIPath, "utf8");
} catch (err) {
  console.warn("Failed to load campaign UI HTML:", err.message);
}

// Input schemas for tools
const sendMessageSchema = {
  message: z.string().min(1, "Message cannot be empty"),
  session_id: z.string().optional(),
};

// ── Tool Functions ────────────────────────────────────────────────────────────

async function callAgent(message, sessionId) {
  const url = new URL("/chat", AGENT_API);
  const sessionId_ = sessionId ?? `session_${Date.now()}`;

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: message }],
        session_id: sessionId_,
      }),
    });
  } catch (err) {
    throw new Error(`Agent API fetch failed: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "<body read error>");
    throw new Error(`Agent API error ${response.status}: ${text}`);
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
      _meta: {
        ui: { resourceUri: "ui://agent/campaign.html" },
      },
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
        
        // Parse structured content from the response
        // The agent response is in markdown/text format
        // We'll extract campaign data for the UI to display
        const parsedData = {
          message: result.message,
          session_id: result.session_id,
          theme: "Campaign Plan",
          description: result.message.substring(0, 200) + "...",
          audience: [],
          messaging: [],
          insights: [],
        };

        // Extract sections from markdown response
        const sections = result.message.split("###");
        sections.forEach((section) => {
          if (section.includes("Audience")) {
            const lines = section.split("\n").filter(l => l.trim().startsWith("-"));
            parsedData.audience = lines.map(l => l.replace(/^-\s*/, "").trim());
          } else if (section.includes("Messaging") || section.includes("Campaign Message")) {
            const lines = section.split("\n").filter(l => l.trim().startsWith("-"));
            parsedData.messaging = lines.map(l => l.replace(/^-\s*/, "").trim());
          } else if (section.includes("Insights") || section.includes("Observations")) {
            const lines = section.split("\n").filter(l => l.trim().startsWith("-"));
            parsedData.insights = lines.map(l => l.replace(/^-\s*/, "").trim());
          }
        });
        
        return {
          content: [{ type: "text", text: result.message }],
          structuredContent: parsedData,
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
      _meta: {},
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

  // ── Register UI Resource (campaign assistant) ──────────────────────────

  registerAppResource(
    server,
    "campaign-ui",
    "ui://agent/campaign.html",
    {},
    async () => ({
      contents: [
        {
          uri: "ui://agent/campaign.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: campaignUIHtml,
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
