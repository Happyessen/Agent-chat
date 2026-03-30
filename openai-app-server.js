// openai-app-server.js — OpenAI App Integration
// Exposes your agent-chat as callable tools for OpenAI Apps
// Install: npm install
// Run:     node openai-app-server.js

import "dotenv/config";
import express from "express";
import cors from "cors";

const AGENT_API = process.env.AGENT_API_URL ?? "http://localhost:3001";
const PORT = process.env.PORT ?? 3002;

const app = express();
app.use(cors());
app.use(express.json());

// ── Tool Definitions ──────────────────────────────────────────────────────────
const tools = [
  {
    id: "send_agent_message",
    name: "Send Agent Message",
    description:
      "Send a message to your n8n agent and get a formatted response. Perfect for campaign analysis, data retrieval, and complex queries.",
    parameters: {
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
    id: "get_agent_health",
    name: "Check Agent Health",
    description: "Check if the agent service is online and responding",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ── Routes ────────────────────────────────────────────────────────────────────

// List available tools
app.get("/tools", (_, res) => {
  res.json({
    tools,
  });
});

// Execute tool
app.post("/tools/execute", async (req, res) => {
  const { tool_id, parameters } = req.body;

  if (!tool_id) {
    return res.status(400).json({ error: "tool_id is required" });
  }

  try {
    if (tool_id === "send_agent_message") {
      const result = await handleAgentMessage(
        parameters.message,
        parameters.session_id
      );
      res.json(result);
    } else if (tool_id === "get_agent_health") {
      const result = await handleHealthCheck();
      res.json(result);
    } else {
      res.status(400).json({ error: `Unknown tool: ${tool_id}` });
    }
  } catch (err) {
    res.status(500).json({
      error: err.message,
      tool: tool_id,
    });
  }
});

// OpenAI API Manifest (for app discovery)
app.get("/.well-known/openai.json", (_, res) => {
  res.json({
    schema_version: "v1",
    name_for_model: "AgentChat",
    name_for_human: "Agent Chat",
    description_for_model:
      "An agent powered by n8n workflows that can analyze campaigns, retrieve data, and execute complex tasks.",
    description_for_human: "Connect to your n8n agent for data analysis and automation",
    auth: {
      type: "none",
    },
    api: {
      type: "openapi",
      url: `${process.env.PUBLIC_URL ?? `http://localhost:${PORT}`}/openapi.json`,
      is_user_authenticated: false,
    },
    logo_url: `${process.env.PUBLIC_URL ?? `http://localhost:${PORT}`}/logo.png`,
    contact_email: "support@example.com",
    legal_info_url: "https://example.com/legal",
  });
});

// OpenAPI specification
app.get("/openapi.json", (_, res) => {
  res.json({
    openapi: "3.0.0",
    info: {
      title: "Agent Chat API",
      version: "1.0.0",
      description: "OpenAI App integration for your agent-chat service",
    },
    servers: [
      {
        url: process.env.PUBLIC_URL ?? `http://localhost:${PORT}`,
      },
    ],
    paths: {
      "/tools": {
        get: {
          summary: "List available tools",
          operationId: "listTools",
          responses: {
            "200": {
              description: "List of available tools",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tools: {
                        type: "array",
                        items: {
                          type: "object",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/tools/execute": {
        post: {
          summary: "Execute a tool",
          operationId: "executeTool",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tool_id: {
                      type: "string",
                      description: "ID of the tool to execute",
                    },
                    parameters: {
                      type: "object",
                      description: "Parameters for the tool",
                    },
                  },
                  required: ["tool_id"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Tool execution result",
            },
          },
        },
      },
    },
  });
});

// Health endpoint
app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Tool Implementations ──────────────────────────────────────────────────────

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
          } else if (data.type === "done") {
            break;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }

  return {
    success: true,
    message: fullText || "No response from agent",
    session_id: sessionId_,
  };
}

async function handleHealthCheck() {
  const url = new URL("/health", AGENT_API);

  try {
    const response = await fetch(url.toString(), { timeout: 5000 });
    const data = await response.json();

    return {
      success: true,
      status: "online",
      agent_status: data,
    };
  } catch (err) {
    return {
      success: false,
      status: "offline",
      error: err.message,
    };
  }
}

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✓ OpenAI App server running on http://localhost:${PORT}`);
  console.log(`✓ Tools available at http://localhost:${PORT}/tools`);
  console.log(`✓ OpenAPI spec at http://localhost:${PORT}/openapi.json`);
  console.log(`✓ OpenAI manifest at http://localhost:${PORT}/.well-known/openai.json`);
});
