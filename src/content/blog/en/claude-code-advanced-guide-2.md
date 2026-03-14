---
title: "Getting More Out of Claude Code (2) — Plugins, MCP, and IDE Integration"
description: "A practical guide to extending Claude Code with plugins, connecting external tools via MCP, and using Claude natively in VS Code"
pubDate: "2026-03-14T19:00:00+09:00"
tags: ["Claude Code", "AI", "Coding Agent", "Plugin", "MCP", "IDE", "VS Code", "Automation"]
lang: en
heroImage: "../../../assets/ClaudeCodeAdvancedGuide.png"
---

## Introduction

In [Part 1](/blog/en/claude-code-advanced-guide-1), we covered memory, skills, and hooks — ways to make Claude remember you and automate repetitive work.

In Part 2, we expand Claude Code's reach **outward**:

- **Plugins**: Bundle skills, agents, hooks, and MCP servers into shareable packages
- **MCP**: Connect external tools like GitHub, Sentry, and databases to Claude
- **IDE Integration**: Use Claude Code natively inside VS Code

---

## 1. Plugins — Bundle and Share Functionality

Plugins package skills, agents, hooks, and MCP servers into **a single distributable unit**. You can create your own or install from a marketplace.

### 1.1 Plugins vs standalone configuration

| Approach | Skill names | Best for |
|---|---|---|
| **Standalone** (`.claude/` directory) | `/hello` | Personal workflows, project-specific customization |
| **Plugins** (`.claude-plugin/plugin.json`) | `/plugin-name:hello` | Team sharing, community distribution, versioned releases |

> Use standalone config for personal use. Use plugins when sharing with teams or the community.

### 1.2 Creating a plugin

#### Directory structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Manifest (required)
├── commands/                # Slash commands
├── skills/                  # Agent skills
│   └── code-review/
│       └── SKILL.md
├── agents/                  # Custom agents
├── hooks/
│   └── hooks.json           # Hook configuration
├── .mcp.json                # MCP server config
└── settings.json            # Default settings
```

#### Writing plugin.json

```json
{
  "name": "my-plugin",
  "description": "Automated code review plugin",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

The `name` becomes the skill namespace. Skills in this plugin are invoked as `/my-plugin:code-review`.

#### Adding a skill

`skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Reviews code for quality and security issues
---

When reviewing code, check for:
1. Code structure and readability
2. Error handling
3. Security vulnerabilities
4. Test coverage
```

#### Local testing

Before publishing to a marketplace or installing with `claude plugin install`, you can test by pointing directly at a local directory:

```bash
# Start Claude Code with ./my-plugin loaded as a temporary plugin
claude --plugin-dir ./my-plugin

# Test multiple plugins at once
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

This **starts a new Claude Code session** with the directory recognized as a plugin. It's only active for that session — once the session ends, the plugin is unloaded.

What to test:

- Skills appear in the `/` command list (e.g., `/my-plugin:code-review`)
- Agents show up in `/agents`
- Hooks trigger on the correct events
- MCP servers connect and appear in `/mcp`

When you modify plugin files during development, run `/reload-plugins` to apply changes without restarting. Note: LSP server configuration changes require a full restart.

### 1.3 Installing plugins & marketplaces

```bash
# Inside Claude Code
/plugins  # Opens plugin management UI
```

Installation scope options:

| Scope | Description |
|---|---|
| **Install for you** | Available in all your projects (user) |
| **Install for this project** | Shared with project collaborators (project) |
| **Install locally** | Only for you, only in this repo (local) |

Marketplaces can be added via GitHub repos, URLs, or local paths. There's an official marketplace, and you can create team-specific ones.

### 1.4 Converting existing config to a plugin

If you already have skills or hooks in `.claude/`, simply move them to a plugin structure:

```bash
mkdir -p my-plugin/.claude-plugin
# Create plugin.json, then:
cp -r .claude/commands my-plugin/
cp -r .claude/skills my-plugin/
cp -r .claude/agents my-plugin/
```

---

## 2. MCP — Connecting External Tools

MCP (Model Context Protocol) is an **open-source standard protocol** for connecting Claude Code to external tools. You can connect hundreds of tools including GitHub, Sentry, databases, Slack, and more.

### 2.1 What you can do with MCP

With MCP servers connected, you can do things like:

```
Implement the feature described in JIRA ENG-4521 and create a PR on GitHub.
```

```
Check Sentry for errors in the last 24 hours and find which deployment caused them.
```

```
Query our PostgreSQL database for this month's revenue data.
```

### 2.2 Installing MCP servers

#### HTTP servers (recommended)

```bash
# Connect to GitHub
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# Connect to Notion
claude mcp add --transport http notion https://mcp.notion.com/mcp

# With authentication header
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

#### stdio servers (local processes)

```bash
# Connect to PostgreSQL
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://readonly:pass@prod.db.com:5432/analytics"

# Connect to Airtable
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server
```

#### Managing servers

```bash
claude mcp list              # List all servers
claude mcp get github        # View details
claude mcp remove github     # Remove a server
/mcp                         # Check status inside Claude Code
```

### 2.3 MCP installation scopes

| Scope | Storage location | Use case |
|---|---|---|
| **local** (default) | `~/.claude.json` | This project, personal only |
| **project** | `.mcp.json` | Shared with team (Git commit) |
| **user** | `~/.claude.json` | Available across all projects |

```bash
# Install for team sharing
claude mcp add --transport http github --scope project \
  https://api.githubcopilot.com/mcp/
```

Project scope creates a `.mcp.json` file — commit it to Git so your whole team gets the same MCP servers.

### 2.4 OAuth authentication

Many cloud MCP servers require OAuth authentication:

```bash
# Add the server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Authenticate inside Claude Code
/mcp
# Follow the browser login flow
```

Tokens are stored securely and refreshed automatically.

### 2.5 Sharing team config with .mcp.json

Create `.mcp.json` at your project root and commit to Git. Environment variable expansion is supported:

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    }
  }
}
```

Use `${VAR:-default}` syntax for defaults. Keep sensitive values like API keys in environment variables.

### 2.6 Using Claude Code as an MCP server

You can expose Claude Code itself as an MCP server:

```bash
claude mcp serve
```

Connect from Claude Desktop to use Claude Code's tools (file reading, editing, etc.):

```json
{
  "mcpServers": {
    "claude-code": {
      "type": "stdio",
      "command": "claude",
      "args": ["mcp", "serve"]
    }
  }
}
```

### 2.7 MCP Tool Search

When you have many MCP servers, tool definitions can overwhelm the context window. **Tool Search** dynamically loads tools on demand instead of preloading them all.

It auto-activates when MCP tool descriptions exceed 10% of the context window. Adjust the threshold:

```bash
# Lower to 5%
ENABLE_TOOL_SEARCH=auto:5 claude

# Disable entirely
ENABLE_TOOL_SEARCH=false claude
```

---

## 3. IDE Integration — Using Claude in VS Code

Claude Code isn't just a terminal tool — it runs **natively inside VS Code**. Install the extension and work with Claude without leaving your editor.

### 3.1 Installation

Requires VS Code 1.98.0 or higher.

1. Press `Cmd+Shift+X` to open Extensions
2. Search for "Claude Code" and click **Install**
3. The Spark icon (✱) appears in the editor toolbar

Or click the [direct install link](vscode:extension/anthropic.claude-code).

### 3.2 Key features

#### Code selection → Ask questions

Select code and Claude automatically sees your highlighted text. Press `Option+K` (Mac) / `Alt+K` (Windows/Linux) to insert an `@file.ts#5-10` reference into your prompt.

#### Review changes

When Claude edits a file, it shows a side-by-side diff. You can accept, reject, or ask for modifications.

#### @-mentions for context

```
@auth.js Explain the authentication logic in this file
@src/components/ Analyze the structure of this folder
```

Fuzzy matching is supported — no need for full paths.

#### Permission modes

Switch modes at the bottom of the prompt box:

| Mode | Behavior |
|---|---|
| **Normal** | Asks permission for each action |
| **Plan** | Shows plan and waits for approval |
| **Auto-accept** | Applies edits without asking |

### 3.3 Conversation history & multiple tabs

- Use the **top dropdown** to search and resume past conversations
- Press `Cmd+Shift+Esc` to open a **new conversation tab**
- Work on different tasks in parallel across multiple tabs/windows

### 3.4 Chrome integration

Install the Chrome extension to automate browser tasks:

```
@browser go to localhost:3000 and check the console for errors
```

### 3.5 VS Code shortcuts

| Command | Shortcut (Mac) | Description |
|---|---|---|
| Focus Input | `Cmd+Esc` | Toggle between editor and Claude |
| New Tab | `Cmd+Shift+Esc` | Open new conversation tab |
| New Conversation | `Cmd+N` | Start new conversation (Claude focused) |
| @-Mention | `Option+K` | Insert current file/selection reference |

### 3.6 JetBrains IDE integration

Claude Code also works with IntelliJ IDEA, WebStorm, and other JetBrains IDEs. Run `claude` in the terminal and use the `/ide` command to connect to your IDE.

---

## Wrapping Up — Real Power Comes From External Connections

Part 1 was about strengthening Claude Code **from within**. Part 2 is about **extending outward**:

1. **Plugins** package functionality and share it with your team
2. **MCP** connects GitHub, Sentry, databases, and other external tools
3. **VS Code extension** lets you use Claude without leaving your editor

In Part 3, we'll cover **sub-agents and agent teams** — splitting complex tasks across multiple agents and processing them in parallel.

---

## References

- [Claude Code Docs — Plugins](https://docs.anthropic.com/en/docs/claude-code/plugins)
- [Claude Code Docs — MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Claude Code Docs — VS Code Extension](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)
- [MCP Official Site](https://modelcontextprotocol.io/)
