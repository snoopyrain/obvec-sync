# Obvec - AI RAG Sync

Sync your Obsidian vault to [Obvec](https://obsidian.10xboost.org) cloud for AI-powered semantic search via MCP.

Once synced, you can search your notes using natural language through **Claude**, **ChatGPT**, **Cursor**, and other MCP-compatible AI assistants.

## How It Works

1. Install the plugin and paste your API key from [obsidian.10xboost.org](https://obsidian.10xboost.org)
2. Your notes are automatically synced and indexed with AI embeddings (multilingual)
3. Connect your MCP endpoint to Claude, ChatGPT, or Cursor
4. Search your notes by meaning, not just keywords

## Features

- **Auto Sync**: Detects file changes and uploads only modified files
- **Incremental**: SHA-256 hash comparison skips unchanged files
- **Multilingual**: Powered by `bge-m3` embedding model (100+ languages)
- **Lightweight**: ~11KB compiled, minimal resource usage
- **Privacy**: Each user's data is fully isolated

## Setup

1. Sign up at [obsidian.10xboost.org](https://obsidian.10xboost.org)
2. Get your API key from the Dashboard
3. Install this plugin in Obsidian
4. Go to Settings > Obvec > paste your API key
5. Click "Sync Now" or wait for auto sync

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your Obvec API key | - |
| Server URL | Obvec server URL | `https://rag.10xboost.org` |
| Auto Sync | Sync on file changes | On |
| Sync Interval | Full sync interval | 15 min |
| Exclude Patterns | Regex patterns to skip files | - |

## Connecting to AI

### Claude.ai
Settings > Connectors > Add MCP Connector > `https://rag.10xboost.org/mcp`

### Claude Code
```bash
claude mcp add -s user -t http obvec https://rag.10xboost.org/mcp
```

### ChatGPT
Settings > Connectors > `https://rag.10xboost.org/chatgpt/mcp`

## Pricing

| | Free | Pro |
|---|---|---|
| Storage | 10MB | 1GB |
| MCP queries | 100/day | Unlimited |
| Price | $0 | $8/mo (yearly) or $12/mo |

## Support

- Website: [obsidian.10xboost.org](https://obsidian.10xboost.org)
- Docs: [obsidian.10xboost.org/docs](https://obsidian.10xboost.org/docs)
