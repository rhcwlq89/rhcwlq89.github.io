---
title: "Getting More Out of Claude Code (2) — Plugins, MCP, and IDE Integration"
description: "A practical guide to extending Claude Code with plugins, connecting external tools via MCP, and using Claude natively in VS Code and JetBrains — verified against the latest 2026 version"
pubDate: "2026-03-14T19:00:00+09:00"
tags: ["Claude Code", "AI", "Coding Agent", "Plugin", "MCP", "IDE", "VS Code", "Automation"]
lang: en
heroImage: "../../../assets/ClaudeCodeAdvancedGuide.png"
---

## Introduction

In [Part 1](/en/blog/claude-code-advanced-guide-1), we covered memory, skills, and hooks -- ways to make Claude remember you and automate repetitive work.

In Part 2, we expand Claude Code's reach <strong>outward</strong>:

- Part 1 — [Memory + Skills + Hooks](/en/blog/claude-code-advanced-guide-1)
- <strong>Part 2 — Plugins + MCP + IDE integration (this post)</strong>
- Part 3 — [Sub-agents + Agent Teams](/en/blog/claude-code-advanced-guide-3)
- Part 4 — [Workflows + Ultrareview + Remote Agents](/en/blog/claude-code-advanced-guide-4)

What we'll cover:

- <strong>Plugins</strong>: bundle skills, agents, hooks, and MCP servers into shareable packages
- <strong>MCP</strong>: connect external tools like GitHub, Sentry, and databases to Claude
- <strong>IDE integration</strong>: use Claude Code natively inside VS Code and JetBrains

> <strong>Note</strong>: This post was checked against the latest version as of June 2026. Commands, flags, and MCP server endpoints change often, so always confirm install commands against each service's official docs or `claude mcp --help`.

---

## TL;DR

- <strong>Plugins are feature bundles.</strong> Package skills, agents, hooks, and external-tool config into one unit to share with your team or community. For solo use, just drop things in `.claude/`.
- <strong>MCP connects external tools.</strong> Attach hundreds of tools -- GitHub, Sentry, databases, Slack -- via a standard protocol. Most install in one command.
- <strong>There are two connection styles.</strong> Cloud services connect remotely (HTTP); local tools run as a process on your machine. Remote servers usually authenticate via browser login (OAuth).
- <strong>When tools pile up, they're loaded on demand.</strong> Instead of loading every tool definition upfront, Claude searches and loads them as needed -- on by default -- to save context.
- <strong>Use it right inside your editor.</strong> VS Code has a dedicated side panel; JetBrains integrates via a plugin. There's also a cloud version that runs in the browser with no install.

---

## 1. Plugins — Bundle and Share Functionality

A plugin packages skills, agents, hooks, and MCP servers into <strong>a single unit</strong>. You can build your own, or install one someone else made from a marketplace.

### 1.1 Plugins vs Standalone Config

| Approach | Skill name | Best for |
|---|---|---|
| <strong>Standalone config</strong> (`.claude/` dir) | `/hello` | Personal workflow, per-project customization |
| <strong>Plugin</strong> (`.claude-plugin/plugin.json`) | `/plugin-name:hello` | Team sharing, community distribution, versioning |

> For solo use, put things directly in `.claude/`; to share with a team or community, make a plugin.

### 1.2 Building a Plugin

#### Directory structure

```text
my-plugin/
├── .claude-plugin/
│   └── plugin.json          # Manifest (required)
├── commands/                # Slash commands
├── skills/                  # Agent skills
│   └── code-review/
│       └── SKILL.md
├── agents/                  # Custom agents
├── hooks/
│   └── hooks.json           # Hook config
├── .mcp.json                # MCP server config
└── settings.json            # Default settings
```

#### Writing plugin.json

```json
{
  "name": "my-plugin",
  "description": "Code review automation plugin",
  "version": "1.0.0",
  "author": {
    "name": "Your Name"
  }
}
```

Only `name` is required; `version` is optional (if omitted, the git commit SHA is used). `author` is an object holding `name`/`email`/`url`, not a string. The `name` becomes the skill namespace, so this plugin's skill is called as `/my-plugin:code-review`.

#### Adding a skill

`skills/code-review/SKILL.md`:

```markdown
---
name: code-review
description: Check code quality and security
---

When reviewing code, check:
1. Code structure and readability
2. Error handling
3. Security vulnerabilities
4. Test coverage
```

#### Local testing

Before publishing to a marketplace, point at a local directory (or `.zip`) to test:

```bash
# Start Claude Code loading ./my-plugin as a temporary plugin
claude --plugin-dir ./my-plugin

# Test multiple plugins at once
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two

# Load from a remote .zip URL for this session only
claude --plugin-url https://example.com/my-plugin.zip
```

This <strong>starts a fresh Claude Code</strong> recognizing that folder as a plugin. It's valid only for that session and disappears when it ends.

Things to test:

- The skill appears in the `/` command list (`/my-plugin:code-review`)
- Agents show up in `/agents`
- Hooks trigger on events
- MCP servers connect in `/mcp`

While developing, edit a file and apply it without restarting via `/reload-plugins`.

### 1.3 Installing Plugins & Marketplaces

```bash
# Inside Claude Code
/plugin  # Open the plugin manager (Discover / Installed / Marketplaces / Errors tabs)
```

> <strong>Note</strong>: The canonical command is `/plugin` (singular). `/plugins` may work in some environments, but the documented form is `/plugin`.

Choose an install scope:

| Scope | Description |
|---|---|
| <strong>Install for you</strong> | Use across all projects (user) |
| <strong>Install for this project</strong> | This project only, shared with team (project) |
| <strong>Install locally</strong> | This project only, just you (local) |

Marketplaces can be added from a GitHub repo (`owner/repo`), a Git URL, a local path, or a `marketplace.json` URL. There's an official marketplace, and you can also build a team-only one.

### 1.4 Converting Existing Config to a Plugin

If you already have skills or hooks in `.claude/`, move them into the plugin structure:

```bash
mkdir -p my-plugin/.claude-plugin
# After creating plugin.json
cp -r .claude/commands my-plugin/
cp -r .claude/skills my-plugin/
cp -r .claude/agents my-plugin/
```

---

## 2. MCP — Connecting External Tools

MCP (Model Context Protocol) is an <strong>open standard protocol</strong> for connecting Claude Code to external tools. You can connect hundreds of tools: GitHub, Sentry, databases, Slack, and more.

```mermaid
flowchart LR
    cc["Claude Code"]
    subgraph servers["MCP servers"]
      gh["GitHub"]
      sentry["Sentry"]
      db["DB (DBHub)"]
    end
    ext["External service APIs"]

    cc <-->|MCP protocol| servers
    servers <-->|each service API| ext
```

### 2.1 What You Can Do with MCP

With an MCP server connected, you can do things like:

```text
Implement the feature described in JIRA ENG-4521 and open a GitHub PR
```

```text
Check Sentry errors from the last 24 hours and analyze which deploy started them
```

```text
Query this month's revenue data from PostgreSQL
```

### 2.2 Recommended MCP Servers

Useful MCP servers by category. Most install in one command. Endpoints can change, so verify against each service's official docs before installing.

#### Development & code management

| Server | Transport | Install command |
|---|---|---|
| <strong>GitHub</strong> | HTTP | `claude mcp add --transport http github https://api.githubcopilot.com/mcp/` |
| <strong>Sentry</strong> | HTTP | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` |
| <strong>Context7</strong> | stdio | `claude mcp add --transport stdio context7 -- npx -y @upstash/context7-mcp` |
| <strong>Stripe</strong> | HTTP | `claude mcp add --transport http stripe https://mcp.stripe.com` |

#### Databases

| Server | Transport | Install command |
|---|---|---|
| <strong>Supabase</strong> | HTTP | `claude mcp add --transport http supabase https://mcp.supabase.com/mcp` |
| <strong>DBHub</strong> | stdio | `claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "connection-string"` |

> DBHub connects PostgreSQL, MySQL, MariaDB, <strong>SQL Server</strong>, and SQLite with a single DSN string. Use a read-only account.
>
> <strong>DSN examples:</strong>
> - PostgreSQL: `postgresql://user:pass@host:5432/db`
> - MySQL: `mysql://user:pass@host:3306/db`
> - SQL Server: `sqlserver://user:pass@host:1433/db`
> - SQLite: `sqlite:///path/to/db.sqlite`

#### Project management & communication

| Server | Transport | Install command |
|---|---|---|
| <strong>Notion</strong> | HTTP | `claude mcp add --transport http notion https://mcp.notion.com/mcp` |
| <strong>Linear</strong> | HTTP | `claude mcp add --transport http linear https://mcp.linear.app/mcp` |
| <strong>Atlassian</strong> | HTTP | `claude mcp add --transport http atlassian https://mcp.atlassian.com/v1/mcp` |
| <strong>Asana</strong> | SSE | `claude mcp add --transport sse asana https://mcp.asana.com/sse` |
| <strong>Slack</strong> | HTTP | `claude mcp add --transport http slack https://mcp.slack.com/mcp` |

> <strong>Caution — transport</strong>: Asana currently uses an SSE endpoint. But <strong>SSE transport is deprecated</strong>, so prefer HTTP when a service offers it. Slack doesn't support dynamic client registration and needs pre-issued OAuth credentials.
>
> The full list is in the [MCP server registry](https://github.com/modelcontextprotocol/servers). Third-party MCP servers aren't vetted by Anthropic, so install only trusted ones.

### 2.3 Installing MCP Servers

#### HTTP servers (recommended)

```bash
# Connect GitHub
claude mcp add --transport http github https://api.githubcopilot.com/mcp/

# With an auth header
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

#### stdio servers (local process)

```bash
# Connect PostgreSQL
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub \
  --dsn "postgresql://readonly:pass@prod.db.com:5432/analytics"

# Connect Airtable (inject env var)
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable \
  -- npx -y airtable-mcp-server
```

#### Managing servers

```bash
claude mcp list              # List
claude mcp get github        # Details
claude mcp remove github     # Remove
/mcp                         # Status / auth inside Claude Code
```

### 2.4 MCP Install Scopes

| Scope | Storage | Use for |
|---|---|---|
| <strong>local</strong> (default) | `~/.claude.json` | This project, just you |
| <strong>project</strong> | `.mcp.json` | Shared with team (Git) |
| <strong>user</strong> | `~/.claude.json` | All projects |

```bash
# Install for team sharing
claude mcp add --transport http github --scope project \
  https://api.githubcopilot.com/mcp/
```

Installing with `--scope project` creates a `.mcp.json`; commit it to Git and the whole team gets the same MCP servers. The default is `local` (just you, current project).

> <strong>Note</strong>: MCP's `local` scope storage (`~/.claude.json`) and Claude Code's general local settings file (`.claude/settings.local.json`) are different files. Don't conflate them.

### 2.5 OAuth Authentication

Many cloud MCP servers require OAuth:

```bash
# Add the server
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp

# Authenticate inside Claude Code
/mcp
# Log in via the browser; it connects automatically
```

Tokens are stored securely and refreshed automatically.

### 2.6 Sharing Team Config via .mcp.json

Create `.mcp.json` at the project root and commit it to Git so the whole team shares the same MCP config. It supports env var substitution:

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

Use `${VAR:-default}` for defaults, and keep sensitive values like API keys in environment variables.

### 2.7 Using Claude Code as an MCP Server

You can turn Claude Code itself into an MCP server:

```bash
claude mcp serve
```

Connect it to Claude Desktop to use Claude Code's tools (file read, edit, etc.) from Claude Desktop:

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

### 2.8 MCP Tool Search — Loading Tools On Demand

When you have many MCP servers, the tool definitions crowd the context window. <strong>Tool Search</strong> doesn't load every tool upfront; it searches and loads them dynamically as needed, saving context and prompt cache.

On supported models (Sonnet 4+/Opus 4+), it's <strong>on by default</strong> (all MCP tools loaded on demand). Tune behavior with the `ENABLE_TOOL_SEARCH` environment variable:

```bash
# Threshold mode: load upfront if tool descriptions fit within 10% of context, defer the overflow
ENABLE_TOOL_SEARCH=auto claude

# Set the threshold to 5%
ENABLE_TOOL_SEARCH=auto:5 claude

# Off (load all tools upfront)
ENABLE_TOOL_SEARCH=false claude
```

> <strong>Caution — changed from before</strong>: It used to default to "auto-activate when tool descriptions exceed 10%," but now the default is <strong>always-deferred</strong>. `auto` is an opt-in that re-enables the old threshold mode. You can mark specific servers `alwaysLoad` to always load them upfront.

---

## 3. IDE Integration — Working Inside Your Editor

Claude Code runs not only in the terminal but <strong>natively inside VS Code and JetBrains IDEs</strong>. You can talk to Claude without leaving your editor.

### 3.1 VS Code

#### Install

Requires VS Code 1.98.0+.

1. `Cmd+Shift+X` to search extensions
2. Search "Claude Code" and <strong>Install</strong>
3. Success when the Spark icon (✱) appears top-right in the editor

#### The dedicated panel (key change)

VS Code integration is no longer just a terminal launch -- a <strong>dedicated graphical side panel</strong> is now the primary interface. Inside the panel:

- <strong>Session history</strong>: search/resume past conversations, and pick up claude.ai web sessions locally (Remote tab)
- <strong>Inline diff review</strong>: view changes side-by-side and accept/reject/request edits
- <strong>Plan mode</strong>: review the plan as a markdown document
- <strong>Checkpoint rewind</strong>: rewind / fork to a specific point

#### Core actions

- <strong>Select code → ask</strong>: select code and Claude recognizes it automatically. `Option+K` (Mac) / `Alt+K` inserts a `@file.ts#5-10` reference.
- <strong>@-mention</strong>: `@auth.js explain this file's auth logic`. Fuzzy matching, no full path needed. Use `@terminal` to reference terminal output.
- <strong>Permission modes</strong>: `default` (ask each time) / `plan` (after approval) / `acceptEdits` (auto-accept) / `bypassPermissions`.
- <strong>Chrome integration</strong>: with the extension installed, `@browser go to localhost:3000 and check console errors` for browser automation.

#### Shortcuts

| Command | Shortcut (Mac) | Description |
|---|---|---|
| Focus Input | `Cmd+Esc` | Toggle editor ↔ Claude |
| New Tab | `Cmd+Shift+Esc` | New conversation tab |
| Reopen Tab | `Cmd+Shift+T` | Reopen a closed session tab |
| @-Mention | `Option+K` | Insert a reference to the current file/selection |

> <strong>Caution (macOS Tahoe and later)</strong>: `Cmd+Esc` may conflict with the system Game Overlay shortcut and not work. Disable it in System Settings → Keyboard → Game Controllers.

### 3.2 JetBrains IDEs

Works in most JetBrains IDEs: IntelliJ IDEA, PyCharm, WebStorm, GoLand, PhpStorm, Android Studio, etc.

#### Install

1. Install the [Claude Code plugin](https://plugins.jetbrains.com/plugin/27310-claude-code-beta-) from the JetBrains Marketplace (currently Beta)
2. Restart the IDE

#### Usage

```bash
# In the IDE's built-in terminal
claude          # Auto-connects to the IDE

# In an external terminal
claude
/ide            # Connect to the IDE
```

#### Key features

| Feature | Description |
|---|---|
| Diff viewer | Show code changes in the IDE's diff viewer |
| Selection context | Selected code is auto-shared with Claude |
| File reference | `Cmd+Option+K` (Mac) / `Alt+Ctrl+K` inserts `@File#L1-99` |
| Diagnostics sharing | IDE lint/syntax errors are auto-forwarded |
| Quick launch | `Cmd+Esc` (Mac) / `Ctrl+Esc` opens Claude Code |

Configure under <strong>Settings → Tools → Claude Code [Beta]</strong>. If ESC doesn't interrupt, uncheck "Move focus to the editor with Escape" in Settings → Tools → Terminal.

### 3.3 Claude Code on the Web — No Install, In the Browser

With no install, connect a GitHub repo at [claude.ai/code](https://claude.ai/code) and spin up a Claude Code session right away (research preview; Pro/Max/Team/Enterprise). It runs on Anthropic-managed cloud infrastructure:

- Sessions keep running even when you close the browser
- Monitor progress from the Claude mobile app
- Includes automatic GitHub PR fixes
- Resume web sessions locally from the Remote tab in VS Code session history

---

## Recap

If Part 1 strengthened Claude Code <strong>from the inside</strong>, Part 2 extends it <strong>outward</strong>:

| Feature | Core |
|---|---|
| <strong>Plugins</strong> | Bundle skills/agents/hooks/MCP to share with the team |
| <strong>MCP</strong> | Connect external tools like GitHub/Sentry/DB (HTTP/stdio) |
| <strong>Tool Search</strong> | Load tools on demand to save context (on by default) |
| <strong>IDE integration</strong> | VS Code panel, JetBrains plugin, web version |

[Part 3](/en/blog/claude-code-advanced-guide-3) covers <strong>sub-agents and agent teams</strong> -- how to split complex work across multiple agents and process it in parallel.

---

## Appendix

### A. Glossary

| Term | Description |
|---|---|
| Plugin | A distribution unit bundling skills/agents/hooks/MCP (`.claude-plugin/plugin.json`) |
| Marketplace | A repository to discover/install plugins (GitHub/URL/local) |
| MCP | Model Context Protocol. The standard for connecting external tools |
| HTTP transport | Connection style for remote cloud MCP servers (recommended) |
| stdio transport | Connection style for a local MCP process on your machine |
| SSE transport | The older remote connection style (deprecated, prefer HTTP) |
| Tool Search | Searching/loading MCP tools on demand instead of upfront |

### B. Command cheat sheet

```bash
# Plugins
/plugin                        # Manager (Discover/Installed/Marketplaces/Errors)
claude --plugin-dir ./plugin   # Test a local plugin
/reload-plugins                # Hot-reload during development

# MCP
claude mcp add --transport http <name> <url>     # Add an HTTP server
claude mcp add --transport stdio <name> -- <cmd> # Add a local server
claude mcp add ... --scope project               # Team-shared (.mcp.json)
claude mcp list / get <name> / remove <name>
claude mcp serve                                 # Claude Code as an MCP server
/mcp                                             # Status / OAuth auth

# IDE
/ide                           # Connect to the IDE from an external terminal
```

### C. References

- [Claude Code Docs — Plugins](https://docs.claude.com/en/docs/claude-code/plugins)
- [Claude Code Docs — MCP](https://docs.claude.com/en/docs/claude-code/mcp)
- [Claude Code Docs — IDE Integrations](https://docs.claude.com/en/docs/claude-code/ide-integrations)
- [Claude Code Docs — Claude Code on the web](https://docs.claude.com/en/docs/claude-code/claude-code-on-the-web)
- [MCP official site](https://modelcontextprotocol.io/)
