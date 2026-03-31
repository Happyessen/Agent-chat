// server.js — OpenAI Agents SDK + n8n webhook wrapper
// Install: npm install openai express cors dotenv
// Run:     node server.js

import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

// ── n8n tool definition ───────────────────────────────────────────────────────
const n8nTool = {
  type: "function",
  function: {
    name: "run_n8n_agent",
    description:
      "Send the user's EXACT message to the n8n agent and return its response. " +
      "Always pass the user's original words verbatim — never rephrase or summarise.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The user's exact message, word for word.",
        },
        session_id: {
          type: "string",
          description: "Session ID for conversation continuity in n8n.",
        },
      },
      required: ["message"],
    },
  },
};

// ── Call n8n webhook ──────────────────────────────────────────────────────────
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

  return (
    data?.output ??
    data?.response ??
    data?.text ??
    data?.message ??
    (typeof data === "string" ? data : JSON.stringify(data))
  );
}

// ── Process tool calls ────────────────────────────────────────────────────────
async function processTool(toolCall, sessionId) {
  const args = JSON.parse(toolCall.function.arguments);
  if (toolCall.function.name === "run_n8n_agent") {
    return await callN8nWebhook(args.message, args.session_id ?? sessionId);
  }
  return `Unknown tool: ${toolCall.function.name}`;
}

// ── Agent loop ────────────────────────────────────────────────────────────────
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

      if (delta.content) {
        assistantMessage.content += delta.content;
        onChunk({ type: "text", content: delta.content });
      }

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

    assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
    if (assistantMessage.tool_calls.length === 0) delete assistantMessage.tool_calls;
    conversationMessages.push(assistantMessage);

    if (!assistantMessage.tool_calls?.length) break;

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
  }

  return conversationMessages;
}

// ── /chat endpoint ────────────────────────────────────────────────────────────
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
    const systemMessage = {
      role: "system",
      content:
        process.env.SYSTEM_PROMPT ??
        `You are a helpful assistant connected to an n8n agent.

CRITICAL: When calling run_n8n_agent, always pass the user's EXACT original message — never rewrite, expand, or summarise it. The message field must contain the user's verbatim words.

When presenting the n8n response back to the user:
- Use ## for section headings, ### for sub-headings
- Use - for bullet points  
- Use **bold** for key terms and values
- Format links as [label](url)
- Keep responses concise and well-structured`,
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