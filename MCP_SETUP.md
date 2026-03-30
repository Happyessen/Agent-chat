# OpenAI App Integration Guide

Your agent-chat is now configured to work as an **OpenAI App with Tool Integration** support!

## What's New?

✅ **OpenAI App Server** (`openai-app-server.js`) - Exposes your agent as callable tools for OpenAI Apps  
✅ **REST API Tools** - Simple HTTP endpoints for tool execution  
✅ **OpenAPI Spec** - Automatic API documentation for OpenAI discovery  
✅ **Production Ready** - Hosted on Render at `https://agent-chat-77l2.onrender.com/`

---

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This installs all required packages. The OpenAI App server has **no additional dependencies** — it uses only Express and CORS from your existing setup.

### 2. Local Testing (Development)

**Terminal 1** - Start your REST API:
```bash
node server.js
```
Runs on `http://localhost:3001`

**Terminal 2** - Start the OpenAI App Server:
```bash
node openai-app-server.js
```
Runs on `http://localhost:3002`

---

## Deployment on Render

### Deploy Both Services

Update your `render.yaml`:

```yaml
services:
  - type: web
    name: agent-chat-rest-api
    runtime: node
    buildCommand: npm install
    startCommand: node server.js
    envVars:
      - key: OPENAI_API_KEY
        sync: false
      - key: N8N_WEBHOOK_URL
        sync: false

  - type: web
    name: agent-chat-openai-app
    runtime: node
    buildCommand: npm install
    startCommand: node openai-app-server.js
    envVars:
      - key: AGENT_API_URL
        value: https://agent-chat-rest-api.onrender.com
      - key: PUBLIC_URL
        value: https://agent-chat-openai-app.onrender.com
```

---

## Connecting to OpenAI Apps

### Using OpenAI's App Store

1. **Get the OpenAI Manifest URL**:
   ```
   https://agent-chat-openai-app.onrender.com/.well-known/openai.json
   ```

2. **In OpenAI Platform**:
   - Go to "Custom GPTs" or "Apps"
   - Click "Create new"
   - Select "Connect to API"
   - Paste the manifest URL above
   - Authorize and use

### Manual API Integration

1. **Get Available Tools**:
   ```bash
   curl https://agent-chat-openai-app.onrender.com/tools
   ```

2. **Execute a Tool**:
   ```bash
   curl -X POST https://agent-chat-openai-app.onrender.com/tools/execute \
     -H "Content-Type: application/json" \
     -d '{
       "tool_id": "send_agent_message",
       "parameters": {
         "message": "Analyze the Wiyyak campaign"
       }
     }'
   ```

---

## Environment Variables

Update your `.env` file:

```env
OPENAI_API_KEY=sk-...                                    # For your REST API
N8N_WEBHOOK_URL=https://your-n8n.com/webhook/xyz        # For n8n integration
AGENT_API_URL=https://agent-chat-rest-api.onrender.com  # For OpenAI App server
PUBLIC_URL=https://agent-chat-openai-app.onrender.com   # Your public OpenAI App URL
PORT=3001                                                 # REST API port (optional)
```

---

## API Reference

### REST API (Original)
```
POST /chat
Content-Type: application/json

{
  "messages": [
    {"role": "user", "content": "Your question here"}
  ],
  "session_id": "optional_session_id"
}
```

### OpenAI App Endpoints (New)

**1. List Tools**
```
GET /tools
```
Response:
```json
{
  "tools": [
    {
      "id": "send_agent_message",
      "name": "Send Agent Message",
      "description": "...",
      "parameters": { ... }
    }
  ]
}
```

**2. Execute Tool**
```
POST /tools/execute
Content-Type: application/json

{
  "tool_id": "send_agent_message",
  "parameters": {
    "message": "Your question here",
    "session_id": "optional_session_id"
  }
}
```

**3. Get OpenAI Manifest**
```
GET /.well-known/openai.json
```
Returns OpenAI app discovery metadata

**4. Get OpenAPI Specification**
```
GET /openapi.json
```
Returns full OpenAPI 3.0 specification

**5. Health Check**
```
GET /health
```

---

## Testing the OpenAI App Server

Test locally:

```bash
# Check if server is running
curl http://localhost:3002/health

# List available tools
curl http://localhost:3002/tools

# Execute a tool
curl -X POST http://localhost:3002/tools/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tool_id": "send_agent_message",
    "parameters": {
      "message": "Analyze the Wiyyak campaign from Zain"
    }
  }'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| OpenAI App can't find your server | Check `PUBLIC_URL` in `.env`, ensure it's publicly accessible |
| Tools not executing | Verify `AGENT_API_URL` points to running REST API server |
| Timeout errors | Check if REST API (`http://localhost:3001`) is running |
| CORS errors | OpenAI App server includes CORS headers automatically |

---

## Next Steps

1. **Test locally** - Run both servers and test tools
2. **Deploy to Render** - Push code with new `openai-app-server.js`
3. **Connect to OpenAI** - Use the manifest URL to register your app
4. **Monitor** - Check Render logs for any issues

---

## Architecture Overview

```
OpenAI Platform / OpenAI App
        ↓
   REST API Call to /tools/execute
        ↓
  openai-app-server.js
        ↓
   REST API Call to /chat
        ↓
  server.js (Your Agent API)
        ↓
  OpenAI Agents SDK
        ↓
  n8n Webhook
```

---

## Files

- **`openai-app-server.js`** - OpenAI App integration server (NEW)
- **`server.js`** - Original REST API (unchanged)
- **`index.html`** - Web UI (unchanged)
- **`.well-known/openai.json`** - Auto-generated on `/` endpoint

Made with ❤️
