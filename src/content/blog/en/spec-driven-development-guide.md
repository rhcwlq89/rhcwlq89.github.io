---
title: "SDD (Spec-Driven Development): The Spec-First Methodology for the AI Era"
description: "Beyond Vibe Coding — write the spec first, let AI generate the code. Covers SDD concepts, workflow, tools, and its realistic limitations."
pubDate: "2026-04-03T22:00:00+09:00"
tags: ["SDD", "Spec-Driven Development", "AI", "Software Engineering", "Development Methodology"]
heroImage: "../../../assets/SpecDrivenDevelopmentGuide.png"
lang: en
---

## Introduction

AI coding tools are everywhere now. **"Just throw a prompt, get code back."** This is **Vibe Coding** — convey a rough intent and let AI figure out the implementation.

The problem: **it works for prototypes but falls apart at production scale**. Vague requirements make AI guess, guesses become bugs, and bugs become tech debt.

SDD (Spec-Driven Development) is the answer. **"Write the spec before writing the code."** Not a new idea. But in an era where AI generates code, the value of specifications has fundamentally changed.

---

## 1. What Is SDD?

SDD is a methodology that treats **specifications as the single source of truth** for development. Code, tests, and documentation are all derived from the spec.

```
Traditional:  Requirements → Write code → Test → Document (managed separately)
SDD:          Write spec → Generate code → Generate tests → Generate docs (spec is the origin of everything)
```

The core principle is simple:

> **"Code is an implementation detail of the specification. When the spec changes, code follows. When code deviates from the spec, the code is wrong."**

SDD was first academically defined in 2004 (combining TDD with Design by Contract), but **gained mainstream attention in 2025 with the rise of AI coding tools**. Thoughtworks included it in the 2025 Technology Radar, and Amazon launched Kiro — an IDE built specifically for SDD workflows.

---

## 2. How Does SDD Differ from TDD and BDD?

| Aspect | TDD | BDD | SDD |
|--------|-----|-----|-----|
| **Primary artifact** | Failing test | Given/When/Then scenario | Spec document (MD, OpenAPI, etc.) |
| **When written** | Per code unit | Per feature | **At system design stage** |
| **Scope** | Unit level | Feature/behavior level | System/architecture level |
| **Primary audience** | Developers | Developers + PO + QA | Developers + AI agents + stakeholders |
| **Role in the AI era** | Code verification | Behavior verification | **Input for AI code generation** |

How they relate:

- **TDD is micro-level SDD.** A failing test is a micro-specification — "this function should behave this way."
- **BDD is SDD's direct ancestor.** Given/When/Then scenarios are executable specs.
- **SDD sits above both.** It defines intent at the system level, while TDD/BDD serve as verification layers below.

```
SDD (system-level spec)
 ├── BDD (feature-level scenarios)
 │    └── TDD (unit-level tests)
 └── AI code generation
```

---

## 3. The SDD Workflow

The standard SDD workflow has four phases.

### 3.1 SPECIFY — Write the Spec

Define **what to build**. No implementation details yet.

```markdown
## Feature: Stock Deduction

### Requirements
- When a user places an order, stock decreases by 1
- If stock is 0, the order is rejected
- Even with 100 concurrent orders, stock never goes negative

### Input
- productId: Long (product ID)
- userId: Long (user ID)

### Output
- Success: return order ID
- Failure: SoldOutException

### Constraints
- Response time: under 200ms
- Concurrency: handle 1,000 requests/sec
```

What makes a good spec:
- **Clear inputs and outputs** — what goes in, what comes out
- **Defined boundary conditions** — zero stock, concurrent requests, timeouts
- **Doesn't dictate implementation** — "handle 1,000 TPS" not "use Redis"

### 3.2 PLAN — Design

Based on the spec, decide **how to build it**.

```markdown
## Design: Stock Deduction

### Architecture
- Spring Boot + PostgreSQL
- Pessimistic locking (FOR UPDATE)
- HikariCP connection pool: 20

### Interface
- POST /api/orders
- Request Body: { "productId": 1, "userId": 1 }
- Response: { "orderId": 123 }

### Data Model
- products (id, name, stock, version)
- orders (id, product_id, user_id, created_at)
```

### 3.3 IMPLEMENT — Build

Write code based on the design. With AI agents, pass the spec and design documents as context for code generation.

```
Spec doc + Design doc → AI agent → Code generation
                                 → Test generation
                                 → API doc generation
```

### 3.4 VALIDATE — Verify

Confirm the generated code meets the spec.

- Are all spec requirements covered by tests?
- Are boundary conditions (zero stock, concurrency) included in tests?
- Are performance constraints (200ms, 1,000 TPS) satisfied?

---

## 4. Three Levels of SDD

SDD scales with adoption depth.

| Level | Description | Spec-Code Relationship |
|-------|-------------|----------------------|
| **Spec-First** | Write spec first, then develop | Spec leads; code may evolve independently afterward |
| **Spec-Anchored** | Maintain spec and code together | Feature changes require spec updates too |
| **Spec-as-Source** | Only edit specs, always generate code | Code is never manually modified (most radical) |

Most teams **start with Spec-First**. Just the habit of writing specs before coding significantly improves AI code generation quality.

**Spec-Anchored** is already common in OpenAPI-based API development. Modify the API spec and client SDKs, server stubs, and docs regenerate automatically.

**Spec-as-Source** is still experimental. Having humans never touch code directly — only specs — has limitations with current AI code generation capabilities for complex systems.

---

## 5. SDD Tools

### 5.1 AI-Era SDD Tools (2025~)

| Tool | Type | Approach | Key Feature |
|------|------|----------|-------------|
| **Amazon Kiro** | IDE (VS Code fork) | Spec-First | Requirements → Design → Tasks workflow |
| **GitHub Spec-Kit** | CLI (open source) | Spec-First | Constitution → Specify → Plan → Tasks |
| **Tessl** | Platform (private beta) | Spec-as-Source | Bidirectional spec↔code sync |
| **Claude Code** | CLI | Spec-First | CLAUDE.md as spec/context |
| **Cursor** | IDE | Spec-First | AGENTS.md + MCP servers for context |

### 5.2 API Spec Tools (Established)

| Tool | Purpose |
|------|---------|
| **OpenAPI / Swagger** | REST API spec definition (JSON/YAML) |
| **Spectral** | OpenAPI spec linting/validation |
| **Redocly** | Auto-generate API docs from specs |

OpenAPI is the most mature example of SDD. A single API spec generates docs, client SDKs, server stubs, and contract tests.

---

## 6. Real-World Impact

Numbers reported from academic papers and production case studies:

| Case | Impact |
|------|--------|
| Financial microservices (OpenAPI + contract testing) | Integration cycle time reduced by **75%** |
| AI code generation (with refined specs) | Code errors reduced by **up to 50%** |
| Delta Airlines (Kiro adoption) | AI dev tool usage grew **1,948%** in 6 months |

More important than the numbers are the **qualitative changes**:
- Eliminates requirement ambiguity — fewer "wait, is that how it's supposed to work?" questions
- Reduces AI hallucination — concrete specs leave less room for AI to guess
- Enables parallel work — clear specs let multiple AI agents implement different parts simultaneously

---

## 7. Limitations and Criticism

SDD isn't a silver bullet. There are sharp criticisms in 2025.

### 7.1 "This Is Just Waterfall Reborn"

The most fundamental criticism. SDD's "Spec → Design → Implement" flow is structurally identical to Waterfall's "Analyze → Design → Implement."

> "Software development is fundamentally a non-deterministic process. No matter how well you write the spec, unforeseen problems will arise."

This criticism is especially valid at the **Spec-as-Source level**. But at the Spec-First level, it's closer to "let's set a direction before starting" — which is different from Waterfall.

### 7.2 Documentation Overload

Tools like Kiro and Spec-Kit generate **mountains of Markdown files**. Even simple features get requirements docs, design docs, and task lists.

> "Like using a sledgehammer to crack a nut." — Martin Fowler

### 7.3 AI Ignores Specs Anyway

Ironically, **AI frequently doesn't follow specs even when provided**. Having a spec can create a false sense of control.

### 7.4 Specs Can't Keep Up with Reality

Edge cases appear in production, performance issues surface under load, user behavior reveals itself only after launch. Specs can't anticipate everything upfront.

As systems grow complex, the **cost of keeping specs in sync with code** grows too. This is a structural limitation of SDD.

### 7.5 Poor Fit for Exploratory Development

For prototypes, research, and experimental work, SDD gets in the way. You can't write a spec when you don't know what you're building yet.

---

## 8. When Should You Use SDD?

| Scenario | SDD Fit | Why |
|----------|:---:|-----|
| API-first development | ✅ | OpenAPI spec → auto-generate code/docs/tests |
| Well-defined requirements | ✅ | Easy to write specs, higher AI generation quality |
| Regulated industries (finance, healthcare) | ✅ | Audit trails, compliance needs spec documentation |
| Cross-team collaboration (frontend-backend) | ✅ | Spec acts as contract, enables parallel development |
| Prototyping / exploratory development | ❌ | Spec-writing overhead slows you down |
| Rapidly changing requirements | ⚠️ | Spec sync costs can grow |
| Simple feature additions | ❌ | Over-documentation is counterproductive |

---

## Summary

| Key Point | Details |
|-----------|---------|
| **What is SDD** | Methodology treating specs as the single source of truth; code/tests/docs derived from specs |
| **Core workflow** | Specify → Plan → Implement → Validate |
| **vs TDD/BDD** | TDD is unit-level, BDD is feature-level, SDD is system-level |
| **Three levels** | Spec-First → Spec-Anchored → Spec-as-Source (gradual adoption) |
| **Proven impact** | 75% reduction in integration time, 50% fewer AI code errors |
| **Key limitations** | Waterfall concerns, doc overload, AI ignoring specs, spec-code sync cost |
| **Best fit** | API-first development, clear requirements, regulated industries, cross-team work |

SDD is the tool that **turns AI coding from "Vibe" into "Engineering."** It doesn't fit every situation, but the simple habit of writing a spec first makes a noticeable difference in AI collaboration quality. You don't need a perfect spec. **Clearly communicating "what you want" to the AI** — that's the essence of SDD.
