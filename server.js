// server.js — OpenAI Agents SDK + n8n webhook wrapper
// Install: npm install openai express cors dotenv
// Run:     node server.js

import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve index.html and any static files from the same folder
app.use(express.static(__dirname));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── n8n tool definition ───────────────────────────────────────────────────────
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // e.g. https://your-n8n.com/webhook/xxx

const n8nTool = {
  type: "function",
  function: {
    name: "run_n8n_agent",
    description:
      "Send a user message to the n8n workflow agent and get a response. " +
      "Use this for any request that the n8n agent should handle.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The user's message or task to send to the n8n agent.",
        },
        session_id: {
          type: "string",
          description: "Optional session ID for conversation continuity in n8n.",
        },
      },
      required: ["message"],
    },
  },
};

// ── Call the n8n webhook ──────────────────────────────────────────────────────
async function callN8nWebhook(message, sessionId) {
  const res = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, session_id: sessionId ?? null }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`n8n webhook error ${res.status}: ${text}`);
  }

  const data = await res.json();

  // n8n typically returns { output: "..." } or { response: "..." } or a string
  // Adjust this to match your actual n8n output node format:
  return (
    data?.output ??
    data?.response ??
    data?.text ??
    data?.message ??
    (typeof data === "string" ? data : JSON.stringify(data))
  );
}

// ── Process tool calls from the model ────────────────────────────────────────
async function processTool(toolCall, sessionId) {
  const args = JSON.parse(toolCall.function.arguments);
  if (toolCall.function.name === "run_n8n_agent") {
    return await callN8nWebhook(args.message, args.session_id ?? sessionId);
  }
  return `Unknown tool: ${toolCall.function.name}`;
}

// ── Agent loop (agentic: keeps running until no more tool calls) ──────────────
async function runAgentLoop(messages, sessionId, onChunk) {
  const conversationMessages = [...messages];

  while (true) {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
      messages: conversationMessages,
      tools: [n8nTool],
      tool_choice: "auto",
      stream: true,
    });

    let assistantMessage = { role: "assistant", content: "", tool_calls: [] };
    let currentToolCall = null;

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Stream text content back to client
      if (delta.content) {
        assistantMessage.content += delta.content;
        onChunk({ type: "text", content: delta.content });
      }

      // Accumulate tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.index !== undefined) {
            if (!assistantMessage.tool_calls[tc.index]) {
              assistantMessage.tool_calls[tc.index] = {
                id: "",
                type: "function",
                function: { name: "", arguments: "" },
              };
            }
            currentToolCall = assistantMessage.tool_calls[tc.index];
          }
          if (tc.id) currentToolCall.id = tc.id;
          if (tc.function?.name) currentToolCall.function.name += tc.function.name;
          if (tc.function?.arguments) currentToolCall.function.arguments += tc.function.arguments;
        }
      }
    }

    // Clean up empty tool_calls
    assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
    if (assistantMessage.tool_calls.length === 0) delete assistantMessage.tool_calls;
    conversationMessages.push(assistantMessage);

    // No tool calls → we're done
    if (!assistantMessage.tool_calls?.length) break;

    // Process each tool call
    onChunk({ type: "tool_start", tools: assistantMessage.tool_calls.map((t) => t.function.name) });

    for (const toolCall of assistantMessage.tool_calls) {
      let result;
      try {
        result = await processTool(toolCall, sessionId);
      } catch (err) {
        result = `Error calling tool: ${err.message}`;
      }

      onChunk({ type: "tool_result", name: toolCall.function.name, result });

      conversationMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
    // Loop again to let the model react to tool results
  }

  return conversationMessages;
}

// ── /chat endpoint (streaming via SSE) ───────────────────────────────────────
app.post("/chat", async (req, res) => {
  const { messages, session_id } = req.body;

  if (!messages?.length) {
    return res.status(400).json({ error: "messages array is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    // System prompt — customize this for your n8n agent
    const systemMessage = {
      role: "system",
      content:
        process.env.SYSTEM_PROMPT ??
        `You are a helpful assistant connected to an n8n agent workflow.

When presenting results, always format your responses using Markdown for clarity and structure. Use headings, bullet points, and links as appropriate. Here's an example format for structured information:

## Section Title
- **Key Point**: Description with [clickable link](https://example.com)
- Another point with **bold emphasis**

### Subsection
- Bullet list item
- Another item

For campaign summaries, use this format:

## Campaign Overview
- **Theme**: Description
- **Highlights**: Key points

## Key Posts and Messaging

### Post A
- **Caption**: "Caption text"
- **Likes**: number
- **Link**: [View post](url)

## Audience and Product Features
- **Target Audience**: Description
- **Key Features**: List

## Observations
- Observation text

Use the run_n8n_agent tool to handle all user requests, then present the results clearly in this formatted style.`,
    };

    await runAgentLoop([systemMessage, ...messages], session_id, send);
    send({ type: "done" });
  } catch (err) {
    console.error(err);
    send({ type: "error", message: err.message });
  } finally {
    res.end();
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`SDK server running on http://localhost:${PORT}`));
