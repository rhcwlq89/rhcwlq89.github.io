---
title: "Getting More Out of Claude Code (1) — Memory, Skills, and Hooks"
description: "A practical guide to Claude Code's memory system (CLAUDE.md, auto memory), 5 bundled skills, custom skills, and workflow automation with hooks"
pubDate: "2026-03-14T18:00:00+09:00"
tags: ["Claude Code", "AI", "Coding Agent", "Memory", "Skills", "Hooks", "DevOps", "Automation"]
lang: en
heroImage: "../../../assets/ClaudeCodeAdvancedGuide.png"
---

## Introduction

Installing Claude Code and having basic conversations to write code — that part is easy. But most users stop there, stuck at the level of "write this code" and "fix this bug."

In reality, Claude Code has powerful features hiding beneath the surface: **project-specific memory**, **repeatable task automation**, and **external tool integration**. Using these features transforms Claude Code from a simple chatbot into **your personalized coding partner**.

This series covers how to get 200% out of Claude Code:

- **Part 1 (this post)**: Memory + Skills + Hooks — Make Claude remember you and automate repetitive work
- **Part 2**: Plugins + MCP + IDE Integration — Connect external tools and use Claude directly in your IDE
- **Part 3**: Sub-agents + Agent Teams — Split complex tasks and process them in parallel

---

## 1. Memory — Making Claude Remember You

Claude Code starts each session with a fresh context window. It doesn't remember yesterday's conversation. **Memory** solves this problem.

### 1.1 CLAUDE.md — Your Project Instruction Manual

`CLAUDE.md` is a markdown file that Claude automatically reads at the start of every session. Write your coding rules, build commands, and architecture descriptions here, and you'll never have to repeat yourself.

#### Scope depends on location

| Location | Scope | Sharing |
|---|---|---|
| `./CLAUDE.md` | Entire project | Shared with team (Git commit) |
| `~/.claude/CLAUDE.md` | All projects | Personal only |
| `.claude/rules/*.md` | Specific file types | Shared with team |

#### Quick start: `/init`

If you're starting fresh, run `/init` inside Claude Code. It analyzes your codebase and auto-generates a `CLAUDE.md`.

```bash
# Inside Claude Code
/init
```

#### Writing effective CLAUDE.md

```markdown
# Project Rules

## Build & Test
- Run dev server with `pnpm dev`
- Run tests with `pnpm test`, always run before commits

## Coding Standards
- 2-space indentation
- TypeScript strict mode
- API handlers go in `src/api/handlers/`

## Architecture
- Frontend: React + Vite
- Backend: Express + Prisma
- DB: PostgreSQL
```

**Key points:**

- Keep it **under 200 lines**. Longer files reduce Claude's adherence.
- Be **specific**. "2-space indentation" instead of "format code properly."
- **Avoid contradicting rules**. If two rules conflict, Claude picks one arbitrarily.

#### Importing other files

When your `CLAUDE.md` grows large, use `@path` syntax to reference external files:

```markdown
# Project Rules
@README.md
@docs/api-conventions.md

## Personal Settings
@~/.claude/my-preferences.md
```

### 1.2 `.claude/rules/` — File-type-specific rules

Rules that don't need to apply to every file can go in `.claude/rules/`. Use `paths` frontmatter to target specific files:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Development Rules
- All endpoints must include input validation
- Use standard error response format
- Include OpenAPI documentation comments
```

This rule only loads when Claude works on TypeScript files under `src/api/`. It saves context space.

### 1.3 Auto Memory — Claude takes its own notes

Auto memory is a system where Claude automatically records things without any user action. It learns and saves build commands, debugging tips, code style preferences, and more during sessions.

#### Storage location

```
~/.claude/projects/<project>/memory/
├── MEMORY.md          # Index (loaded at every session start)
├── debugging.md       # Debugging patterns
├── api-conventions.md # API design decisions
└── ...
```

#### Enable/disable

```bash
# Inside Claude Code
/memory  # Toggle auto memory + open memory files

# Or via settings.json
{
  "autoMemoryEnabled": false
}
```

#### Teaching Claude to remember

Tell Claude "remember this" and it saves to auto memory:

```
Always use pnpm, not npm. Remember this.
```

Use the `/memory` command to review and edit saved content. They're plain markdown files, so you can edit them directly.

### 1.4 CLAUDE.md vs Auto Memory — When to use which

| | CLAUDE.md | Auto Memory |
|---|---|---|
| **Who writes it** | You | Claude automatically |
| **Content** | Rules and instructions | Learned patterns |
| **Scope** | Project/user/org | Per project |
| **Use for** | Coding standards, workflows | Build commands, debugging tips, preferences |

> **Summary**: Use `CLAUDE.md` for rules you share with your team. Use auto memory to let Claude learn your habits.

---

## 2. Skills — Teaching Claude New Abilities

Skills teach Claude **how to perform specific tasks**. A single `SKILL.md` file teaches Claude a new command.

### 2.1 Bundled Skills — 5 ready-to-use skills

Claude Code ships with built-in skills. No installation needed — just type `/` followed by the name.

#### `/batch` — Parallel large-scale codebase changes

Orchestrates large-scale changes across a codebase in parallel. It researches the codebase, decomposes work into 5-30 independent units, and once approved, **spawns a separate agent for each unit** working in isolated git worktrees. Each agent implements, tests, and creates a PR.

```bash
# Examples
/batch migrate src/ from Solid to React
/batch add input validation to all API handlers
/batch replace all console.log with structured logger
```

> The key here is **parallelism**. Instead of modifying 30 files sequentially, 30 agents work simultaneously.

#### `/simplify` — Auto code review & fix

Reviews recently changed files for code reuse, quality, and efficiency issues, then fixes them. Spawns **three review agents** in parallel, each analyzing from a different perspective, then aggregates findings and applies fixes.

```bash
/simplify                          # Review all recently changed files
/simplify focus on memory efficiency  # Review with specific focus
```

#### `/debug` — Session debug log analysis

Reads your current Claude Code session's debug log to diagnose issues. Useful when you're wondering "why did it just do that?"

```bash
/debug                  # Analyze full session
/debug MCP connection issue    # Focus on specific problem
```

#### `/loop` — Repeating execution scheduler

Runs a prompt or slash command at a set interval. Useful for monitoring deployments, managing PRs, etc.

```bash
/loop 5m check if the deploy finished
/loop 10m /simplify
```

#### `/claude-api` — Load Claude API reference

When writing code that uses the Claude API or Anthropic SDK, loads language-specific API reference (Python, TypeScript, Java, etc.). Also auto-activates when your code imports `anthropic` or `@anthropic-ai/sdk`.

```bash
/claude-api  # Manually load API reference
```

### 2.2 Creating custom skills

Beyond bundled skills, you can create **your own skills**. All you need is a `SKILL.md` file.

#### Where to store skills

| Location | Scope |
|---|---|
| `~/.claude/skills/<name>/SKILL.md` | All your projects |
| `.claude/skills/<name>/SKILL.md` | This project only |

#### Example: Blog post generator skill

```yaml
---
name: blog-post
description: Generates a blog post draft in both Korean and English versions
disable-model-invocation: true
---

Write a blog post:

1. Create a blog post about $ARGUMENTS
2. Generate Korean version in `src/content/blog/`
3. Generate English version in `src/content/blog/en/`
4. Include current time in pubDate (e.g., 2026-03-14T18:00:00+09:00)
5. Korean uses casual tone, English uses practical tone
6. heroImage paths: Korean `../../assets/`, English `../../../assets/`
```

Usage:

```bash
/blog-post Writing Terraform Modules
```

#### Example: Code explainer skill

```yaml
---
name: explain-code
description: Explains code with analogies and diagrams
---

When explaining code:

1. **Start with an analogy**: Compare to something from everyday life
2. **Draw a diagram**: Use ASCII art to show flow/structure/relationships
3. **Walk through the code**: Explain step-by-step what happens
4. **Highlight a gotcha**: Point out common mistakes or misconceptions
```

This skill has no `disable-model-invocation`, so Claude auto-activates it for questions like "how does this code work?"

#### Controlling skill invocation

| Setting | User invocation | Claude auto-invocation |
|---|---|---|
| (default) | Yes | Yes |
| `disable-model-invocation: true` | Yes | No |
| `user-invocable: false` | No | Yes |

- **`disable-model-invocation: true`**: For tasks with side effects like deployment or commits. You don't want Claude auto-deploying because "the code looks ready."
- **`user-invocable: false`**: For background knowledge like legacy system context. Users won't invoke `/legacy-context` directly, but Claude referencing it automatically during related work is useful.

#### Dynamic context injection

The `` !`command` `` syntax injects shell command output before the skill runs:

```yaml
---
name: pr-summary
description: Summarize a PR
context: fork
agent: Explore
---

## PR Context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Task
Summarize this PR...
```

**How it works:**

1. You run `/pr-summary`
2. Shell commands like `` !`gh pr diff` `` execute **first**
3. Each command's output replaces the `` !`command` `` placeholder as plain text
4. The fully resolved content is then passed to Claude

So what Claude actually sees is something like this:

```markdown
## PR Context
- PR diff: (actual diff output here)
- PR comments: (actual comment content here)
- Changed files: (actual file list here)

## Task
Summarize this PR...
```

Think of `` !`command` `` as a **template variable**. Since you can't hardcode data into a skill file, it means "insert this command's output here at runtime."

**Frontmatter explained:**

| Field | Purpose |
|---|---|
| `context: fork` | Runs this skill in a separate sub-agent (prevents polluting main conversation context) |
| `agent: Explore` | Sets the forked sub-agent type to Explore (read-only) |

Without `context: fork`, the skill runs directly in the main conversation. For cases like PR diffs where output can be large, forking isolates the work and saves your main conversation's context window.

> **What are agent types?** Claude Code has built-in agent types specialized for different purposes. `Explore` is for codebase search (read-only, uses the Haiku model), `Plan` is for planning, and `general-purpose` is for any task (all tools available). You can also create custom agents. See [Part 3](/blog/en/claude-code-advanced-guide-3) for details.

---

## 3. Hooks — Workflow Automation

Hooks are **commands that execute automatically** at specific points in Claude Code's lifecycle. If skills teach Claude "how to do things," hooks "automatically run code on specific events."

### 3.1 What are hooks

- **After file edits** → Auto-run Prettier
- **Before dangerous commands** → Block them
- **When Claude waits for input** → Desktop notification
- **On session start** → Load environment variables

Hooks implement these automations.

### 3.2 Creating your first hook

Let's get a desktop notification when Claude waits for input.

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

> On Linux, use `notify-send 'Claude Code' 'Claude Code needs your attention'`.

Type `/hooks` to verify registered hooks.

### 3.3 Practical hook recipes

#### Auto-format after file edits

`.claude/settings.json` (project level):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write"
          }
        ]
      }
    ]
  }
}
```

Prettier only runs after `Edit` or `Write` tools — not after `Bash`, `Read`, or other tools.

#### Block edits to protected files

Block modifications to sensitive files like `.env`, `package-lock.json`, `.git/`.

`.claude/hooks/protect-files.sh`:

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

PROTECTED_PATTERNS=(".env" "package-lock.json" ".git/")

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH matches protected pattern '$pattern'" >&2
    exit 2  # exit 2 = block
  fi
done

exit 0
```

```bash
chmod +x .claude/hooks/protect-files.sh
```

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh"
          }
        ]
      }
    ]
  }
}
```

#### Re-inject context after compaction

After long conversations, context compaction (`/compact`) may lose important details. Auto-inject reminders after every compaction:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Reminder: use pnpm, not npm. Run pnpm test before commits. Current sprint: auth refactor.'"
          }
        ]
      }
    ]
  }
}
```

#### Bash command logging

Log all Bash commands Claude executes to a file:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' >> ~/.claude/command-log.txt"
          }
        ]
      }
    ]
  }
}
```

### 3.4 Prompt-based hooks — AI-powered judgment

Instead of rule-based (exit 0/2) decisions, hooks can use **AI judgment**. When Claude finishes a task, verify if it's really done:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Check if all requested tasks are complete. If not, respond with {\"ok\": false, \"reason\": \"description of remaining work\"}."
          }
        ]
      }
    ]
  }
}
```

If `"ok": false` is returned, Claude continues working instead of stopping.

### 3.5 Hook events summary

| Event | When it fires | Use case |
|---|---|---|
| `SessionStart` | Session start/resume | Load env vars, inject context |
| `UserPromptSubmit` | User submits prompt | Input validation, add context |
| `PreToolUse` | Before tool execution | Block dangerous commands, protect files |
| `PostToolUse` | After tool execution | Auto-format, logging |
| `Notification` | Notification sent | Desktop notifications |
| `Stop` | Claude finishes responding | Completion verification |
| `SessionEnd` | Session ends | Cleanup tasks |

### 3.6 Hook configuration locations

| Location | Scope |
|---|---|
| `~/.claude/settings.json` | All your projects |
| `.claude/settings.json` | This project (shared with team) |
| `.claude/settings.local.json` | This project (personal only) |

---

## Wrapping Up — The Power of Combining All Three

Memory, skills, and hooks are each powerful on their own, but **their real strength comes from combining them**:

1. Define project rules in **CLAUDE.md**
2. Automate repetitive tasks (deployment, blog writing, code review) with **custom skills**
3. Set up file protection, auto-formatting, and notifications with **hooks**

This transforms Claude Code from a simple AI chat into a **development partner customized for your project**.

In the next Part 2, we'll cover **plugins, MCP, and IDE integration**. We'll install useful plugins from the marketplace, connect external services with MCP, and learn how to use Claude Code directly from IntelliJ IDEA.

---

## References

- [Claude Code Docs — Memory](https://docs.anthropic.com/en/docs/claude-code/memory)
- [Claude Code Docs — Skills](https://docs.anthropic.com/en/docs/claude-code/skills)
- [Claude Code Docs — Hooks Guide](https://docs.anthropic.com/en/docs/claude-code/hooks-guide)
- [Claude Code Docs — Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
