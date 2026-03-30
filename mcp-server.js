// mcp-server.js — OpenAI App MCP Server
// This server wraps your agent-chat API as an MCP-compatible service
// Install: npm install @modelcontexprotocol/sdk dotenv
// Run:     node mcp-server.js

import "dotenv/config";
import { StdioServerTransport } from "@modelcontexprotocol/sdk/server/stdio.js";
import { Server } from "@modelcontexprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  TextContent,
} from "@modelcontexprotocol/sdk/types.js";

// ── Configuration ─────────────────────────────────────────────────────────────
const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:3001";

// ── Initialize MCP Server ─────────────────────────────────────────────────────
const server = new Server(
  {
    name: "agent-chat-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool Definitions ──────────────────────────────────────────────────────────
const tools = [
  {
    name: "send_agent_message",
    description:
      "Send a message to your n8n agent and get a formatted response. Perfect for campaign analysis, data retrieval, and complex queries.",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Your question or command for the agent (e.g., 'analyse the Wiyyak campaign')",
        },
        session_id: {
          type: "string",
          description: "Optional: Reuse a specific session for conversation continuity",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "get_agent_health",
    description: "Check if the agent service is online and responding",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── List Tools Handler ────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// ── Call Tool Handler ─────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "send_agent_message") {
      return await handleAgentMessage(args.message, args.session_id);
    } else if (name === "get_agent_health") {
      return await handleHealthCheck();
    } else {
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
});

// ── Tool Implementation: Send Agent Message ───────────────────────────────────
async function handleAgentMessage(message, sessionId) {
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

  // Stream the response and collect all data
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
          } else if (data.type === "done") {
            break;
          }
        } catch (e) {
          // Ignore parse errors for keep-alive lines
        }
      }
    }
  }

  return {
    content: [
      {
        type: "text",
        text: fullText || "No response from agent",
      },
    ],
  };
}

// ── Tool Implementation: Health Check ──────────────────────────────────────
async function handleHealthCheck() {
  const url = new URL("/health", AGENT_API);

  try {
    const response = await fetch(url.toString(), { timeout: 5000 });
    const data = await response.json();

    return {
      content: [
        {
          type: "text",
          text: `Agent is online: ${JSON.stringify(data)}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Agent is offline: ${err.message}`,
        },
      ],
      isError: true,
    };
  }
}

// ── Start Server ──────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Chat MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Failed to start MCP server:", err);
  process.exit(1);
});
