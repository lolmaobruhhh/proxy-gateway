# ⚡ Proxy Gateway

A **universal, provider-agnostic AI proxy** with a built-in management dashboard. Route any frontend (SillyTavern, JanitorAI, TypingMind, anything) through a single endpoint to any number of upstream AI providers — OpenAI, Gemini, Anthropic, Claude, or even private/reverse-engineered endpoints.

## Features

- **Wildcard routing** — any endpoint path, any HTTP method, passed through
- **Prefix-based model routing** — `opn:gpt-4o` routes to OpenAI, `gm:gemini-2.5-pro` routes to Gemini
- **Multi-key round-robin** with automatic fallback on auth errors
- **Sandbox JSON templates** — transform requests to match any upstream API format (even reverse-engineered ones)
- **Stream handling** — SSE passthrough, stream↔non-stream auto-conversion
- **Dashboard UI** — add, edit, delete providers; browse models; view live stats
- **Zero frontend modifications** — works with any app that has an "API Key" field
- **Persistent storage** via `/data` mount (HF Spaces compatible)
- **CORS wide open** — use from anywhere

---

## Quick Deploy (Hugging Face Spaces)

1. Create a new **Docker** Space on [huggingface.co/spaces](https://huggingface.co/spaces)
2. Upload all project files
3. Set these **Secrets** in Space Settings:
   - `DELETE_PASSWORD` — admin password for deleting providers
4. Enable **Persistent Storage** (mounts to `/data`)
5. Space builds and deploys automatically

---

## How It Works

```
┌──────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  SillyTavern /   │         │              │         │   OpenAI        │
│  JanitorAI /     │────────▶│  Proxy       │────────▶│   Gemini        │
│  Any Frontend    │◀────────│  Gateway     │◀────────│   Anthropic     │
│                  │         │              │         │   Any Upstream   │
└──────────────────┘         └──────────────┘         └─────────────────┘
```

1. Frontend sends request with model `opn:gpt-4o`
2. Proxy strips prefix `opn`, looks up provider config
3. Extracts API keys from `Authorization` header
4. Transforms request using sandbox template (if configured)
5. Forwards to upstream, handles streaming
6. Returns response to frontend

---

## Setup Guide

### Adding a Provider (Basic)

1. Go to the **+ Add** tab
2. Fill in:
   - **Prefix**: `opn` (short unique code)
   - **Name**: `OpenAI`
   - **Upstream URL**: `https://api.openai.com`
   - **Auth Type**: Bearer (default)
3. Click **Save Provider**

### Adding a Provider (Advanced — Sandbox)

For non-standard APIs, paste a **Sandbox JSON** template:

```json
{
  "url_path": "/v2/chat/completions",
  "headers": {
    "content-type": "application/json",
    "accept": "text/event-stream",
    "authorization": "Bearer {{KEY}}",
    "x-api-key": "{{KEY}}"
  },
  "body_template": {
    "model": "{{MODEL}}",
    "stream": true,
    "messages": "{{MESSAGES}}"
  },
  "forced_fields": {
    "stream": true
  }
}
```

#### Placeholders

| Placeholder | Replaced With |
|---|---|
| `{{KEY}}` | Current API key (from round-robin) |
| `{{MODEL}}` | Model name (prefix stripped) |
| `{{MESSAGES}}` | Full messages array from request |
| `{{SYSTEM}}` | System message extracted from messages |
| `{{NON_SYSTEM_MESSAGES}}` | Messages array without system message |

#### Fields

| Field | Purpose |
|---|---|
| `url_path` | Override the request path sent to upstream |
| `headers` | Custom headers for upstream (use `{{KEY}}` placeholder) |
| `body_template` | Base request body — incoming fields merged into this |
| `forced_fields` | Always override these fields regardless of user input |

---

## Connecting from Frontends

### API Key Format

In your frontend's "API Key" or "API Token" field, enter keys in this format:

```
opn=sk-key1,sk-key2;gm=AIza-key1,AIza-key2;cl=sk-ant-key1
```

- **Prefix** = the short code you set when adding the provider
- **Multiple keys** separated by commas (round-robin + fallback)
- **Multiple providers** separated by semicolons

### Model Name Format

When selecting a model, prefix it:

```
opn:gpt-4o
gm:gemini-2.5-pro
cl:claude-sonnet-4-20250514
```

### Endpoint

Point your frontend to:

```
https://your-space-url.hf.space/v1/chat/completions
```

Or any path — the proxy catches everything.

### Model List

```
https://your-space-url.hf.space/v1/models
```

Returns all models from all providers in OpenAI format with prefixes prepended.

---

## Dashboard Tabs

| Tab | Function |
|---|---|
| **+ Add** | Register a new upstream provider |
| **Providers** | View, edit, delete providers. Click for details + edit history |
| **Models** | Browse fetched models, filter by provider, save API keys to browser |
| **Stats** | Live request counts, errors, unique users, active connections |

---

## API Reference

### Provider Management

```
GET    /api/providers                    List all providers
POST   /api/providers                    Create provider
GET    /api/providers/:prefix            Get one provider
PUT    /api/providers/:prefix            Update provider
DELETE /api/providers/:prefix            Delete (requires {"password": "..."})
GET    /api/providers/:prefix/history    Edit history
```

### Models

```
GET    /api/models                       List cached models
POST   /api/models/fetch                 Fetch models from all providers
POST   /api/models/fetch/:prefix         Fetch models from one provider
GET    /v1/models                        OpenAI-compatible model list
```

### Stats

```
GET    /api/stats                        Live statistics
```

### Proxy

```
ANY    /*                                Wildcard proxy (catches all non-API routes)
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7860` | Server port |
| `DATA_DIR` | `/data` | Persistent storage directory |
| `DELETE_PASSWORD` | `changeme` | Password for deleting providers |

---

## License

Do whatever you want with it. No restrictions.
