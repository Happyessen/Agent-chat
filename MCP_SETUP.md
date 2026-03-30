# OpenAI Apps SDK Integration Guide

Your agent-chat is now configured as a **proper OpenAI App** using the **Apps SDK** with **MCP Protocol**.

## What's New?

✅ **MCP Server** (`app-mcp-server.js`) - Follows OpenAI's Apps SDK quickstart pattern  
✅ **Native MCP Protocol** - Uses `/mcp` endpoint that ChatGPT expects  
✅ **Registered Tools** - `send_message` and `check_agent_health` callable by ChatGPT  
✅ **Optional UI Component** - Dashboard rendered inside ChatGPT (included)  
✅ **Production Ready** - Deploy to Render

---

## What Changed

This is **different from the REST API approach**. Now you're building a proper **OpenAI App** that:
- Uses **Model Context Protocol (MCP)** - the standard for ChatGPT integrations
- Exposes a **`/mcp` endpoint** (not REST endpoints)
- Registers **tools** that ChatGPT can discover and call
- Can include **UI components** rendered in ChatGPT's interface

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

New packages added:
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@modelcontextprotocol/ext-apps` - OpenAI Apps SDK helpers
- `zod` - Input validation for tools

### 2. Local Testing (Development)

**Terminal 1** - Start your REST API (unchanged):
```bash
node server.js
```
Runs on `http://localhost:3001`

**Terminal 2** - Start the MCP App Server (NEW):
```bash
node app-mcp-server.js
```
Runs on `http://localhost:8787/mcp`

### 3. Expose to Public Internet (for development)

ChatGPT needs to reach your server. Use **ngrok** to create a tunnel:

```bash
npm install -g ngrok
ngrok http 8787
```

You'll get a URL like: `https://abc123.ngrok.app`

Your MCP endpoint becomes: `https://abc123.ngrok.app/mcp`

---

## Deployment on Render

### Deploy the MCP Server Service

Create a **new Web Service** on Render with:

**Build Command**:
```bash
npm install
```

**Start Command**:
```bash
node app-mcp-server.js
```

**Environment Variables**:
```
AGENT_API_URL=https://agent-chat-rest-api.onrender.com
PORT=8787
```

This creates your public MCP endpoint at: `https://agent-chat-mcp.onrender.com/mcp`

---

## Connecting to ChatGPT

### 1. Enable Developer Mode
In ChatGPT:
- Go **Settings → Apps & Connectors → Advanced settings**
- Enable **Developer mode**

### 2. Create a Connector
- **Settings → Connectors → Create**
- Paste your MCP URL: `https://your-domain.onrender.com/mcp` (or your ngrok URL)
- Name it: "Agent Chat"
- Add description: "Connect to your n8n agent for analysis and automation"
- **Create**

### 3. Use in a Chat
- Open a new chat
- Click **More** (after the + button)
- Select **Agent Chat** connector
- Start chatting!

Example prompts:
```
"Analyze the Wiyyak campaign from Zain"
"Is my agent online?"
"Get data on the travelling campaign"
```

---

## Tools Available in ChatGPT

### 1. **send_message**
Send a message to your n8n agent and get a formatted response.

**Parameters**:
- `message` (required): Your question or command
- `session_id` (optional): Continue a conversation session

**Example**:
```
"Analyze the Wiyyak campaign from Zain Bahrain"
```

### 2. **check_agent_health**
Check if your agent is online and responding.

No parameters needed.

---

## API Reference

### MCP Endpoint Structure

```
HTTP POST/GET/DELETE https://your-domain.com/mcp
```

The MCP protocol handles JSON-RPC messages. ChatGPT communicates directly with this endpoint.

### Health Check Endpoint

```
GET http://localhost:8787/health

Response:
{
  "status": "ok",
  "timestamp": "2026-03-30T..."
}
```

---

## Testing Locally

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest \
  --server-url http://localhost:8787/mcp \
  --transport http
```

This opens a browser interface to test your tools.

### Simple Health Check

```bash
curl http://localhost:8787/health
```

---

## File Structure

```
agent-chat/
├── server.js              # Original REST API (unchanged)
├── app-mcp-server.js      # NEW: OpenAI App MCP Server
├── index.html             # Web UI (unchanged)
├── package.json           # Updated dependencies
└── .env                   # Configuration
```

---

## Environment Variables

Update your `.env`:

```env
# REST API (unchanged)
OPENAI_API_KEY=sk-...
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/xyz
PORT=3001

# MCP Server (new)
AGENT_API_URL=https://agent-chat-rest-api.onrender.com
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| ChatGPT can't connect | Verify `/mcp` URL is publicly accessible, check firewall |
| "Not Found" error on `/mcp` | Make sure you're using `app-mcp-server.js`, not `server.js` |
| Tools not appearing | Refresh the connector in ChatGPT settings |
| Agent not responding | Verify `AGENT_API_URL` points to running REST API |
| ngrok tunnel expires | Reinstall package, ngrok free tier has 2-hour limit per session |

---

## Architecture Overview

```
ChatGPT / OpenAI Platform
        ↓
   MCP Protocol (JSON-RPC)
        ↓
  app-mcp-server.js (/mcp)
        ↓
   REST API Call
        ↓
  server.js (/chat)
        ↓
  OpenAI Agents SDK
        ↓
  n8n Webhook
```

---

## Next Steps

1. **Test locally** with `node app-mcp-server.js`
2. **Expose to internet** using ngrok
3. **Add to ChatGPT** via Settings → Connectors
4. **Deploy to Render** for production
5. **Iterate** on tools and UI

---

## Resources

- [OpenAI Apps SDK Quickstart](https://developers.openai.com/apps-sdk/quickstart) - Official guide
- [MCP Specification](https://modelcontextprotocol.io/) - Protocol details
- [Examples](https://github.com/openai/openai-apps-sdk-examples) - Code samples

---

Made with ❤️ using OpenAI Apps SDK
