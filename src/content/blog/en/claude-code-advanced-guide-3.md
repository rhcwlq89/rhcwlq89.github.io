---
title: "Getting More Out of Claude Code (3) — Sub-agents and Agent Teams"
description: "A practical guide to delegating tasks with sub-agents and orchestrating parallel collaboration with agent teams in Claude Code"
pubDate: "2026-03-14T20:00:00+09:00"
tags: ["Claude Code", "AI", "Coding Agent", "Sub-agent", "Agent Team", "Parallel", "Automation"]
lang: en
heroImage: "../../../assets/ClaudeCodeAdvancedGuide.png"
---

## Introduction

In [Part 1](/blog/en/claude-code-advanced-guide-1), we covered memory, skills, and hooks. In [Part 2](/blog/en/claude-code-advanced-guide-2), we covered plugins, MCP, and IDE integration.

In this final Part 3, we cover Claude Code's **most powerful features**:

- **Sub-agents**: Create specialized AI assistants that handle specific types of tasks
- **Agent Teams**: Multiple Claude Code instances working together as a coordinated team

---

## 1. Sub-agents — Delegate to Specialists

Sub-agents are **independent AI assistants specialized for specific tasks**. Each sub-agent has its own context window, system prompt, and tool access. When Claude encounters a matching task, it automatically delegates to the appropriate sub-agent.

### 1.1 Why sub-agents

- **Preserve context**: Exploration results don't clutter your main conversation
- **Enforce constraints**: Limit which tools a sub-agent can use
- **Control costs**: Route tasks to faster, cheaper models like Haiku
- **Specialize behavior**: Domain-specific system prompts improve accuracy

### 1.2 Built-in sub-agents

Claude Code ships with built-in sub-agents:

| Agent | Model | Tools | Purpose |
|---|---|---|---|
| **Explore** | Haiku (fast) | Read-only | Codebase search, file discovery |
| **Plan** | Inherited | Read-only | Context gathering in plan mode |
| **General-purpose** | Inherited | All | Complex multi-step tasks |
| **Claude Code Guide** | Haiku | Read-only | Questions about Claude Code features |

The Explore agent is used automatically when Claude needs to search the codebase. Exploration results stay in the sub-agent's context, keeping your main conversation clean.

### 1.3 Creating custom sub-agents

#### The /agents command

```bash
# Inside Claude Code
/agents
# → Create new agent → Choose User-level or Project-level
# → Generate with Claude or write manually
```

#### Writing agent files manually

Sub-agents are Markdown files with YAML frontmatter.

**Storage locations:**

| Location | Scope | Priority |
|---|---|---|
| `.claude/agents/` | Current project | High |
| `~/.claude/agents/` | All projects | Medium |
| Plugin `agents/` | Where plugin is enabled | Low |

#### Example: Code reviewer

`.claude/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code after changes.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior code reviewer ensuring high standards of code quality.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code clarity and structure
- Error handling
- Security vulnerabilities (exposed secrets, etc.)
- Test coverage

Provide feedback by priority:
- Critical (must fix)
- Warning (should fix)
- Suggestion (consider improving)
```

Usage:

```
Use the code-reviewer sub-agent to review my recent changes
```

#### Example: Debugger

```markdown
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior
tools: Read, Edit, Bash, Grep, Glob
---

Debugging process:
1. Capture error messages and stack traces
2. Identify reproduction steps
3. Form and test hypotheses
4. Apply minimal fix
5. Verify the fix works
```

### 1.4 Sub-agent configuration options

#### Model selection

```yaml
model: haiku    # Fast and cheap
model: sonnet   # Balanced
model: opus     # Most capable
model: inherit  # Same as main conversation (default)
```

#### Tool restrictions

```yaml
# Allow only specific tools
tools: Read, Grep, Glob, Bash

# Block specific tools
disallowedTools: Write, Edit
```

#### Scoped MCP servers

Connect MCP servers exclusively to a sub-agent. They won't appear in the main conversation, saving context:

```yaml
---
name: browser-tester
description: Tests features with Playwright
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
  - github  # Reference an already-configured server
---
```

#### Persistent memory

Give sub-agents memory that persists across conversations:

```yaml
---
name: code-reviewer
description: Code review specialist
memory: user  # user | project | local
---
```

| Scope | Location | Use case |
|---|---|---|
| `user` | `~/.claude/agent-memory/` | Learnings across all projects |
| `project` | `.claude/agent-memory/` | Project-specific knowledge (shareable via Git) |
| `local` | `.claude/agent-memory-local/` | Project-specific, personal only |

#### Git worktree isolation

```yaml
isolation: worktree
```

The sub-agent works in a separate Git worktree, making changes without affecting your main code. If no changes are made, the worktree is automatically cleaned up.

### 1.5 Foreground vs background

- **Foreground**: Main conversation waits until the sub-agent finishes. Permission prompts are passed through to you.
- **Background**: Runs concurrently with your main conversation. Press `Ctrl+B` to send a running task to the background.

```
Run the test suite in a background sub-agent and report only failing tests
```

### 1.6 Usage patterns

#### Isolate high-volume output

Delegate test runs and log analysis to sub-agents so verbose output doesn't consume your main conversation context:

```
Use a sub-agent to run the full test suite and report only failing tests with error messages
```

#### Parallel research

Spawn multiple sub-agents for independent investigations:

```
Research the authentication, database, and API modules in parallel using separate sub-agents
```

#### Chaining

Use sub-agents sequentially for multi-step workflows:

```
Use the code-reviewer sub-agent to find performance issues, then use the optimizer sub-agent to fix them
```

---

## 2. Agent Teams — Multiple Claudes Working Together

> Agent teams are **experimental** and disabled by default.

Agent teams let **multiple Claude Code instances collaborate as a team**. One session acts as the team lead, coordinating work. Teammates work independently in their own context windows and communicate directly with each other.

### 2.1 Sub-agents vs agent teams

|  | Sub-agents | Agent Teams |
|---|---|---|
| **Context** | Own window, returns results to main | Fully independent |
| **Communication** | Reports to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only results matter | Complex work requiring discussion and collaboration |
| **Token cost** | Lower | Higher (each teammate is a separate instance) |

> Sub-agents: "just bring me the results." Agent teams: "discuss and solve it together."

### 2.2 Enabling agent teams

Add to `settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

### 2.3 Starting a team

Describe the team structure in natural language:

```
I'm designing a CLI tool. Create an agent team to explore from three angles:
- One on UX
- One on technical architecture
- One playing devil's advocate
```

Claude creates the team, spawns teammates, and coordinates work.

### 2.4 Display modes

| Mode | Description | Requirements |
|---|---|---|
| **in-process** | All teammates in one terminal | Any terminal |
| **split panes** | Each teammate in a separate pane | tmux or iTerm2 |

```json
{
  "teammateMode": "in-process"
}
```

Use `Shift+Down` to cycle between teammates. You can message each teammate directly.

### 2.5 Communicating with teammates

- **Lead → Teammates**: Assign tasks, give instructions
- **Teammate → Teammate**: Share findings directly, challenge each other's theories
- **User → Teammate**: Select a teammate with `Shift+Down` and type directly

```
Tell the security reviewer teammate to focus on the auth module
```

### 2.6 Task management

A shared task list coordinates work:

- The lead creates tasks and assigns them
- Teammates auto-claim the next unassigned task when they finish
- Task dependencies are managed automatically (blocked until predecessor completes)

### 2.7 Plan approval mode

For risky or complex work, require teammates to plan before implementing:

```
Have the architect teammate refactor the auth module, but require plan approval before changes
```

The teammate submits a plan, the lead reviews and approves/rejects. Rejected plans get feedback for revision.

### 2.8 Practical use cases

#### Parallel code review

```
Review PR #142 with an agent team. Three reviewers:
- Security focus
- Performance focus
- Test coverage focus
```

Each reviewer analyzes the same PR from a different angle simultaneously.

#### Competing hypothesis debugging

```
Users report the app exits after one message instead of staying connected.
Spawn 5 teammates to investigate different hypotheses.
Have them debate and try to disprove each other's theories like a scientific discussion.
```

Solo debugging often anchors on the first plausible explanation. Multiple investigators actively trying to disprove each other reach the real root cause faster.

### 2.9 Best practices

1. **Provide enough context**: Teammates don't inherit the lead's conversation history. Include all necessary info in the spawn prompt.
2. **3-5 teammates is optimal**: Balances parallel work with manageable coordination and token costs.
3. **5-6 tasks per teammate**: Keeps everyone productive without excessive context switching.
4. **Avoid file conflicts**: Don't have multiple teammates edit the same file. Assign different files to different teammates.
5. **Monitor and steer**: Check on progress periodically and redirect when approaches aren't working.

### 2.10 Limitations

- In-process teammates aren't restored on session resume
- One team per session only
- Teammates can't create their own teams
- Lead role can't be transferred
- Split pane mode not supported in VS Code integrated terminal

---

## 3. Oh My Claude Code — Community Multi-Agent Framework

[Oh My Claude Code (OMCC)](https://github.com/Yeachan-Heo/oh-my-claudecode) is a **community open-source project** that adds multi-agent orchestration on top of Claude Code. Just as Oh My Zsh extends zsh, OMCC adds agents, skills, and automatic model routing to Claude Code.

### 3.1 Key features

- **32 specialized agents**: Pre-built agents for architecture, security, testing, code review, data science, and more
- **40+ skills**: Pre-configured skills for common development tasks
- **Smart model routing**: Automatically routes to Haiku (simple tasks) or Opus (complex reasoning) based on task complexity. 30-50% token savings

### 3.2 Orchestration modes

| Mode | Description | Best for |
|---|---|---|
| **Team** | `plan → prd → exec → verify → fix` pipeline | Structured feature development |
| **Autopilot** | Fully autonomous execution, zero intervention | Simple feature implementation |
| **Ultrapilot** | Up to 5 parallel workers | Multi-component projects |
| **Ralph** | Continuous verify/fix loops until complete | Critical work |
| **Pipeline** | Sequential staged processing | Multi-step transformations |

### 3.3 Agent Teams vs OMCC

|  | Agent Teams (built-in) | OMCC (community) |
|---|---|---|
| **Setup** | Enable with one env variable | Install from plugin marketplace |
| **Configuration** | Natural language team composition | Keywords (`ralph`, `autopilot`, etc.) |
| **Agents** | Define yourself or describe in natural language | 32 pre-defined |
| **Model routing** | Manual (`model:` field) | Automatic (complexity-based) |
| **Workflow** | Free-form — teammates self-coordinate | Structured — pipelines and verification loops |
| **Token cost** | Higher (each teammate is a separate instance) | 30-50% savings via routing |
| **Stability** | Experimental feature | Community-maintained |
| **Best for** | Collaborative work needing debate and discussion | Systematic, repeatable workflows |

> Agent Teams are "multiple Claudes debating and solving together." OMCC is "systematic processing through pre-built pipelines." They don't conflict — you can use OMCC's agents alongside Agent Teams.

> OMCC's signature feature, Ralph (continuous verify/fix loops until completion), is also available as an official Claude Code plugin called `ralph-wiggum`. You can use it directly from the official plugin marketplace without installing OMCC.

### 3.4 Installation

```bash
# Install as a Claude Code plugin
/plugins  # Search for oh-my-claudecode in the marketplace and install
```

For details, see the [OMCC official docs](https://ohmyclaudecode.com/).

---

## Wrapping Up the Series

Across three parts, we've covered all of Claude Code's advanced features:

| Part | Topic | Key takeaway |
|---|---|---|
| **Part 1** | Memory + Skills + Hooks | Make Claude remember you and automate repetitive work |
| **Part 2** | Plugins + MCP + IDE | Connect external tools and use Claude in your editor |
| **Part 3** | Sub-agents + Agent Teams | Split tasks and process them in parallel |

Combining these features transforms Claude Code from a simple chatbot into **a development partner optimized for your project**:

- **CLAUDE.md** sets the rules
- **Custom skills** automate repetitive tasks
- **Hooks** handle file protection, formatting, and notifications
- **Plugins** share functionality with your team
- **MCP** connects GitHub, Sentry, databases, and more
- **Sub-agents** delegate to specialists
- **Agent teams** process complex tasks in parallel

You don't need to use everything at once. Start with one feature, see how it fits your workflow, and gradually build up your personalized setup.

---

## References

- [Claude Code Docs — Sub-agents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
- [Claude Code Docs — Agent Teams](https://docs.anthropic.com/en/docs/claude-code/agent-teams)
- [Claude Code Docs — Git Worktrees](https://docs.anthropic.com/en/docs/claude-code/common-workflows#run-parallel-claude-code-sessions-with-git-worktrees)
