# Obvec - AI Search for Your Second Brain

Let **Claude**, **ChatGPT**, and **Cursor** search your Obsidian vault using natural language. Ask questions about your notes, discover connections, and find anything — powered by semantic search via MCP.

## Why Obvec?

Your Obsidian vault is your second brain. But AI assistants can't access it. Obvec bridges that gap — install the plugin, and your notes become instantly searchable by any MCP-compatible AI.

**Ask things like:**
- "What did I write about marketing strategy?"
- "Find my meeting notes from last week"
- "What are my notes related to machine learning?"

It understands meaning, not just keywords. Works in **100+ languages** including English, Chinese, Japanese, Korean.

## How It Works

1. Sign up at [obsidian.10xboost.org](https://obsidian.10xboost.org) and get your API key
2. Install this plugin and paste your API key
3. Your vault syncs automatically in the background
4. Add the MCP endpoint to your AI assistant — done!

## Connect to AI

### Claude.ai
Settings > Connectors > Add MCP Connector > `https://rag.10xboost.org/mcp`

### Claude Code
```bash
claude mcp add -s user -t http obvec https://rag.10xboost.org/mcp
```

### ChatGPT
Settings > Connectors > `https://rag.10xboost.org/chatgpt/mcp`

### Cursor / Windsurf
Add MCP endpoint: `https://rag.10xboost.org/mcp`

## Features

- **Semantic Search**: Find notes by meaning, not just keywords
- **Multilingual**: 100+ languages (bge-m3 embeddings)
- **Incremental Sync**: Only uploads changed files (SHA-256 hash)
- **Privacy**: Each user's data is fully isolated
- **Lightweight**: ~11KB, minimal resource usage

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your Obvec API key | - |
| Auto Sync | Sync on file changes | On |
| Sync Interval | Full sync interval | 15 min |
| Exclude Patterns | Regex patterns to skip files | - |

## Pricing

| | Free | Pro |
|---|---|---|
| Storage | 10MB | 1GB |
| MCP queries | 100/day | Unlimited |
| Price | $0 | $8/mo (yearly) or $12/mo |

## Support

- Website: [obsidian.10xboost.org](https://obsidian.10xboost.org)
- Docs: [obsidian.10xboost.org/docs](https://obsidian.10xboost.org/docs)
