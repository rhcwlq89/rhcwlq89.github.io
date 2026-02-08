---
title: "Oh My OpenCode Setup Guide: Mastering the Terminal AI Coding Agent"
description: "A practical guide to installing Oh My OpenCode plugin for OpenCode and configuring multi-agent orchestration, LSP/AST tools, and MCP integrations"
pubDate: 2026-02-08T20:00:00+09:00
lang: en
tags: ["OpenCode", "Oh My OpenCode", "AI", "Coding Agent", "Terminal", "DevOps"]
heroImage: "../../assets/OhMyOpenCodeSetupGuide.png"
---

## Introduction

Terminal-based AI coding agents are evolving rapidly. While there are various tools like Claude Code and Copilot CLI, the most notable in the open-source space is **OpenCode**.

**OpenCode** is a Go-based terminal AI coding agent that supports 75+ models including Claude, GPT, and Gemini, performing coding, debugging, and refactoring through a TUI (Terminal User Interface).

**Oh My OpenCode** is an all-in-one plugin for OpenCode that provides:

- Multi-model orchestration (automatic optimal model assignment per role)
- Async parallel agent execution
- LSP/AST-based deterministic refactoring tools
- Built-in MCPs (web search, official docs lookup, GitHub code search)
- Claude Code-compatible hook system

This guide covers everything from OpenCode installation to Oh My OpenCode configuration and core feature usage, step by step.

---

## 1. Installing OpenCode

### 1.1 Installation Methods

```bash
# macOS (Homebrew)
brew install opencode

# npm
npm install -g opencode

# Direct download
curl -fsSL https://opencode.ai/install | bash
```

### 1.2 Verify Installation

```bash
opencode --version
# 1.0.150 or higher recommended
```

> **Note**: Oh My OpenCode requires OpenCode 1.0.132 or higher. Earlier versions may experience configuration file corruption.

---

## 2. Installing Oh My OpenCode

### 2.1 Interactive Installation (Recommended)

The simplest method is running the interactive installation CLI:

```bash
# Using Bun (recommended)
bunx oh-my-opencode install

# Or using Node.js
npx oh-my-opencode install
```

### 2.2 Agent-Assisted Installation

Enter the following prompt into OpenCode, Claude Code, or any AI agent for automatic installation:

```
Install and configure oh-my-opencode by following the instructions here:
https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/refs/heads/master/docs/guide/installation.md
```

### 2.3 Subscription Flags

Specify flags based on your AI service subscriptions during installation:

```bash
bunx oh-my-opencode install --no-tui \
  --claude=yes \
  --openai=yes \
  --gemini=yes \
  --copilot=no
```

| Flag | Description | Values |
|------|-------------|--------|
| `--claude` | Anthropic Claude subscription | `yes`, `no`, `max20` (Max 20x mode) |
| `--openai` | OpenAI/ChatGPT Plus | `yes`, `no` |
| `--gemini` | Google Gemini | `yes`, `no` |
| `--copilot` | GitHub Copilot | `yes`, `no` |
| `--opencode-zen` | OpenCode Zen | `yes`, `no` |
| `--zai-coding-plan` | Z.ai Coding Plan | `yes`, `no` |

**Subscription combination examples:**

```bash
# All subscriptions
--claude=max20 --openai=yes --gemini=yes

# Claude only
--claude=yes --gemini=no --copilot=no

# GitHub Copilot fallback
--claude=no --gemini=no --copilot=yes
```

> **Important**: Without a Claude subscription, the core agent Sisyphus may not function properly.

### 2.4 Verify Installation

```bash
# Check plugin registration
cat ~/.config/opencode/opencode.json
```

If the `plugin` array in `opencode.json` contains `"oh-my-opencode"`, the installation was successful:

```json
{
  "plugin": ["oh-my-opencode"]
}
```

---

## 3. Authentication Setup

### 3.1 Anthropic (Claude)

```bash
opencode auth login
# Anthropic → Claude Pro/Max → Complete OAuth flow
```

### 3.2 Google Gemini (Antigravity OAuth)

To use Gemini, you need to add the `opencode-antigravity-auth` plugin:

```json
{
  "plugin": ["oh-my-opencode", "opencode-antigravity-auth@latest"]
}
```

```bash
opencode auth login
# Google → OAuth with Google (Antigravity)
```

> You can register up to 10 Google accounts, and when rate limits hit, accounts are automatically rotated.

### 3.3 GitHub Copilot

Since January 2026, GitHub officially partnered with OpenCode, allowing Copilot subscribers (Pro, Pro+, Business, Enterprise) to authenticate without an additional license:

```bash
opencode auth login
# GitHub → OAuth authentication
```

### 3.4 Provider Priority

When multiple providers are authenticated, they are prioritized in this order:

```
Native (anthropic, openai, google)
  > GitHub Copilot
    > OpenCode Zen
      > Z.ai Coding Plan
```

---

## 4. Understanding the Agent System

The core of Oh My OpenCode is its **role-based specialized agent system**. Each agent has a unique model and responsibility.

### 4.1 Main Agents

| Agent | Model | Role |
|-------|-------|------|
| **Sisyphus** | Claude Opus 4.5 High | Team leader — task coordination, parallel agent management |
| **Hephaestus** | GPT 5.2 Codex Medium | Autonomous deep worker — goal-oriented execution |
| **Oracle** | GPT 5.2 Medium | Design consultation, debugging, architecture |
| **Frontend** | Gemini 3 Pro | Frontend UI/UX development |
| **Librarian** | Claude Sonnet 4.5 | Official docs lookup, open-source implementation search |
| **Explore** | Claude Haiku 4.5 | Ultra-fast codebase exploration |
| **Prometheus** | - | Planning and task decomposition |
| **Metis** | - | Plan consultation and strategic advice |

### 4.2 Agent Workflow

```
User Request
    │
    ▼
  Sisyphus (Team Leader)
    │
    ├─→ Explore (code search)           ← parallel
    ├─→ Librarian (docs lookup)         ← parallel
    │
    ├─→ Hephaestus (implementation)     ← sequential
    │     └─→ 2-5 exploration agents    ← self-parallel
    │
    └─→ Oracle (code review)            ← on demand
```

### 4.3 Sisyphus — Relentless Completion

Named after the Greek mythological figure, this is the core orchestrator agent. Through **Todo enforcement mode**, it ensures tasks never stall midway:

- Tracks task lists (Todos) and automatically resumes incomplete items
- Uses parallel agents to keep the main context window clean
- Automatically detects and removes excessive AI-generated comments

### 4.4 Hephaestus — The Autonomous Craftsman

An autonomous agent that explores and implements on its own when given a goal:

- Spawns 2-5 background exploration agents in parallel before taking action
- Learns existing codebase patterns to maintain consistency
- Targets 100% completion and runs until finished

---

## 5. Configuration Customization

### 5.1 Configuration File Locations

| Scope | Path |
|-------|------|
| User global | `~/.config/opencode/oh-my-opencode.json` |
| Project local | `.opencode/oh-my-opencode.json` |

> Both files support JSONC format (comments and trailing commas allowed).

### 5.2 Changing Agent Models

When you want to use a model different from the default:

```jsonc
{
  // Override models per agent
  "agents": {
    "sisyphus": {
      "model": "claude-opus-4-5-20250929",
      "temperature": 0.7
    },
    "hephaestus": {
      "model": "gpt-5.2-codex",
      "temperature": 0.5
    },
    "explore": {
      "model": "claude-haiku-4-5-20251001"
    }
  }
}
```

### 5.3 Background Task Concurrency Limits

You can limit the number of concurrent background agents per provider:

```jsonc
{
  "background_tasks": {
    "limits": [
      { "provider": "anthropic", "max_concurrent": 3 },
      { "provider": "openai", "max_concurrent": 5 },
      { "provider": "google", "max_concurrent": 4 }
    ]
  }
}
```

### 5.4 Category-Based Task Delegation

Define which agent handles which type of task:

```jsonc
{
  "categories": {
    "visual": {
      "agent": "frontend",
      "description": "UI/UX, CSS, component styling"
    },
    "business-logic": {
      "agent": "hephaestus",
      "description": "Business logic, APIs, data processing"
    }
  }
}
```

### 5.5 Disabling Specific Features

Turn off unnecessary hooks or agents:

```jsonc
{
  "disabled_hooks": ["comment-checker"],
  "disabled_agents": ["frontend"],
  "disabled_mcps": ["exa"]
}
```

---

## 6. Core Feature Usage

### 6.1 Ultrawork Mode

Include `ultrawork` or `ulw` in your prompt to automatically activate all advanced features:

```
ulw refactor the authentication system for this project
```

Features activated:
- Automatic parallel agent execution
- Background exploration tasks
- Deep codebase analysis
- Relentless execution until completion

### 6.2 Prometheus Mode (Planning)

For complex tasks, it's more effective to plan first:

1. Press `Tab` to enter Prometheus mode
2. Requirements are organized through an interview format
3. A work plan is automatically generated
4. Execute with the `/start-work` command

### 6.3 Built-in MCPs (Model Context Protocol)

Three MCPs are included and ready to use without additional configuration:

| MCP | Function | Use Case |
|-----|----------|----------|
| **Exa** | Web search | Latest information, library usage lookup |
| **Context7** | Official docs access | Framework/library official documentation |
| **grep_app** | GitHub code search | Open-source implementation pattern reference |

### 6.4 LSP/AST Tools

Uses deterministic tools for code modifications to improve stability:

- **Refactoring**: Safely restructure code based on AST
- **Rename**: Batch symbol renaming across the entire project
- **Diagnostics**: Automatic linter/formatter execution and result integration
- **AST Search**: Intelligent code search that understands syntactic structure

### 6.5 Built-in Skills

| Skill | Function |
|-------|----------|
| **playwright** | Browser automation (E2E testing, screenshots) |
| **git-master** | Atomic, semantically meaningful Git commits |

### 6.6 Session Tools

You can leverage previous work sessions:

- List sessions
- Read previous session content
- Search sessions by keyword
- Analyze sessions and restore context

---

## 7. Rules System

Oh My OpenCode's rules system allows the AI to automatically learn your project's principles and conventions.

### 7.1 Rules File Structure

```
.opencode/
├── oh-my-opencode.json      # Project config
└── rules/
    ├── general.md            # Global rules
    ├── auth/
    │   └── rules.md          # Rules specific to auth/ directory
    └── api/
        └── rules.md          # Rules specific to api/ directory
```

### 7.2 Automatic Rule Application

When the AI interacts with files under the `auth/` directory, the corresponding `rules.md` is automatically referenced. For example:

```markdown
<!-- .opencode/rules/auth/rules.md -->
## Authentication Module Rules

- All auth logic must be implemented with Spring Security
- JWT token expiration time must be managed via environment variables
- Passwords must always be hashed with BCrypt
- Use MockUser annotation for testing
```

---

## 8. Hook System

Provides 25+ hooks compatible with Claude Code:

| Hook | Timing | Example Use |
|------|--------|-------------|
| `PreToolUse` | Before tool use | Prevent dangerous file modifications |
| `PostToolUse` | After tool use | Auto-run linting |
| `UserPromptSubmit` | On prompt submission | Input validation, keyword detection |
| `Stop` | On agent stop | Cleanup tasks |

---

## 9. Important Notes

### 9.1 Anthropic OAuth Restriction

As of January 2026, Anthropic restricted third-party OAuth access citing Terms of Service violations. Oh My OpenCode itself does not include a custom OAuth implementation, but you should be aware of these restrictions when using it.

### 9.2 Beware of Impersonation Sites

`ohmyopencode.com` is an impersonation site unaffiliated with the official project. Always download from the official GitHub releases page.

### 9.3 Version Compatibility

OpenCode **versions before 1.0.132** had configuration file corruption issues (fixed after PR#5040). Make sure to update to 1.0.150 or higher before using.

---

## 10. Uninstallation

When you no longer need the plugin:

```bash
# 1. Remove plugin
jq '.plugin = [.plugin[] | select(. != "oh-my-opencode")]' \
    ~/.config/opencode/opencode.json > /tmp/oc.json && \
    mv /tmp/oc.json ~/.config/opencode/opencode.json

# 2. Remove config files (optional)
rm -f ~/.config/opencode/oh-my-opencode.json
rm -f .opencode/oh-my-opencode.json
```

---

## Summary

| Item | Details |
|------|---------|
| **OpenCode** | Go-based terminal AI coding agent (75+ model support) |
| **Oh My OpenCode** | All-in-one plugin for OpenCode |
| **Core Agents** | Sisyphus (orchestration), Hephaestus (implementation), Oracle (design), Librarian (docs) |
| **Installation** | `bunx oh-my-opencode install` |
| **Config File** | `~/.config/opencode/oh-my-opencode.json` (JSONC) |
| **Magic Keyword** | `ultrawork` / `ulw` — auto-activates all advanced features |
| **Built-in MCPs** | Exa (web search), Context7 (official docs), grep_app (GitHub search) |
| **Planning Mode** | `Tab` → Prometheus mode → `/start-work` |

Oh My OpenCode isn't just about bringing an AI chatbot to the terminal — it builds a development environment where role-specialized agents collaborate like a team. With the right subscriptions and configuration, you can kick off even complex projects with a single `ulw`.

---

## References

- [OpenCode Official Site](https://opencode.ai/)
- [Oh My OpenCode GitHub](https://github.com/code-yeongyu/oh-my-opencode)
- [Oh My OpenCode Installation Guide](https://github.com/code-yeongyu/oh-my-opencode/blob/dev/docs/guide/installation.md)
