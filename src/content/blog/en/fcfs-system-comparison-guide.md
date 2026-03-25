---
title: "First-Come-First-Served Systems Explained: 6 Implementation Strategies and How to Choose"
description: "Breaks down the core challenges of FCFS systems — concurrency, stock deduction, duplicate prevention — and compares 6 implementation strategies from DB locks to Redis, message queues, waiting queues, and token issuance."
pubDate: "2026-03-20T14:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Redis", "Database", "Message Queue"]
heroImage: "../../../assets/FcfsSystemComparisonGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/db-deadlock-and-lock-strategy-guide), we covered the limits of FOR UPDATE. When 100 users hit simultaneously, 99 wait in line, the connection pool gets exhausted, and deadlock risk follows. **DB locks alone can't handle a high-traffic first-come-first-served system.**

This post steps back to see the big picture — **what problems does a FCFS system need to solve, what options exist, and when should you use each one?**

---

## 1. What Is a First-Come-First-Served System?

Concert ticket sales, limited-edition sneaker drops, flash deals — all systems that **allocate a fixed quantity to whoever requests first**. Sounds simple, but when thousands flood in simultaneously, three core problems emerge.

### The 3 Core Problems

| Problem | Description | What happens if unsolved? |
|---------|-------------|--------------------------|
| **Concurrency control** | Thousands try to deduct the same stock at the same instant | 100 items in stock, 150 people purchase successfully (overselling) |
| **Accurate stock deduction** | Non-atomic deduction operations cause miscounts | Stock goes negative, or two requests read the same value and only one deduction registers |
| **Duplicate prevention** | Same user submits multiple requests and wins multiple times | One person takes 10 items |

> **Analogy**: A bakery selling 100 limited loaves. Without a line (no concurrency control), people scramble and grab. If two clerks both see "1 left" at the same time and each hand out a loaf (deduction error), 1 loaf turns into 2 successful purchases. Without checking tickets (no duplicate prevention), one person lines up multiple times.

---

## 2. The 6 Implementation Strategies

### 2.1 DB Pessimistic Lock (SELECT FOR UPDATE)

**Core principle**: Lock the stock row first, deduct, then release — processing one request at a time.

| Step | Client | Server (DB) | Status |
|:---:|--------|------------|:------:|
| 1 | Purchase request | `SELECT stock FOR UPDATE` → row locked | 🔒 |
| 2 | | Check stock > 0 → `UPDATE stock = stock - 1` | ✅ Deducted |
| 3 | | `COMMIT` → lock released | 🔓 |
| 4 | Next request | Can now acquire lock → repeat | ⏳ |

| Pros | Cons |
|------|------|
| No additional infrastructure (just the DB) | Concurrent requests are serialized (99 wait) |
| Simple implementation | Deadlock risk |
| Strong data consistency | DB connection pool exhaustion risk |

**Best for**: Under a few dozen concurrent users, early-stage services without extra infrastructure

### 2.2 Redis Atomic Operations (DECR)

**Core principle**: `DECR` is a Redis command that decrements a key's value by 1. Since Redis processes all commands on a single thread, `DECR` is inherently atomic — making stock deduction safe without any locks.

| Step | Client | Server (Redis → DB) | Status |
|:---:|--------|---------------------|:------:|
| 1 | Purchase request | `DECR stock_key` → check result | |
| 2 | | Result ≥ 0 → purchase success, save order to DB | ✅ |
| 3 | | Result < 0 → `INCR stock_key` (rollback) → sold out response | ❌ |

| Pros | Cons |
|------|------|
| Tens of thousands of TPS | Data loss risk on Redis failure |
| Atomic without locks | Need to manage Redis-DB data consistency |
| Relatively simple implementation | Rollback logic needed (when result < 0) |

**Best for**: Hundreds to thousands of concurrent users, services where fast response matters

### 2.3 Redis + Lua Script

Redis can execute Lua scripts internally via the `EVAL` command. Every command inside a script is processed as a single atomic unit, so no other request can intervene mid-execution.

**Core principle**: Bundle stock check and deduction into a single Lua script that executes atomically. Unlike plain DECR, **"check → deduct" runs as one unit**, eliminating negative stock entirely.

| Step | Client | Server (Redis → DB) | Status |
|:---:|--------|---------------------|:------:|
| 1 | Purchase request | Lua script execution starts (atomic) | 🔒 |
| 2 | | Check stock > 0 + check duplicate + DECR → all at once | |
| 3 | | Result: success → save order to DB, failure → immediate response | ✅ / ❌ |

| Pros | Cons |
|------|------|
| Stock check + deduction + duplicate check in one atomic op | Lua script debugging is difficult |
| Negative stock is impossible | Data loss risk on Redis failure |
| No rollback logic needed (check-then-deduct) | Long scripts can block Redis |

**Best for**: Thousands to tens of thousands of concurrent users, where stock check + deduction + duplicate prevention all need to happen at the Redis level without hitting the DB. Ideal when plain DECR's rollback logic becomes a burden, or when you don't want to handle duplicate checks in a separate layer.

### 2.4 Message Queue (Kafka / RabbitMQ)

**Core principle**: Push purchase requests into a queue, and consumers process them one by one in order. The requests themselves are serialized.

| Step | Client | Server (Queue → Consumer → DB) | Status |
|:---:|--------|-------------------------------|:------:|
| 1 | Purchase request | Publish message to queue → immediate "accepted" response | 📨 |
| 2 | | Consumer processes messages in order | ⏳ |
| 3 | | Check stock → deduct → create order | ✅ / ❌ |
| 4 | Check result (polling / websocket) | Deliver processing result | 📬 |

| Pros | Cons |
|------|------|
| Handles traffic spikes (acts as a buffer) | Asynchronous response (no immediate result) |
| Server load distribution | High implementation complexity (queue + consumer + result delivery) |
| Scalable by adding consumers | Additional infrastructure required (Kafka / RabbitMQ) |

**Best for**: Massive traffic, cases where immediate response isn't critical (coupon issuance, event entries)

### 2.5 Waiting Queue

**Core principle**: Place users in a queue with assigned positions, then admit them to the purchase page when their turn comes. The "N people ahead of you" pattern seen on Ticketmaster and similar platforms.

| Step | Client | Server (Redis Sorted Set) | Status |
|:---:|--------|--------------------------|:------:|
| 1 | Connect | `ZADD queue timestamp userId` → enter queue | 🕐 Waiting |
| 2 | "342 people ahead" display | `ZRANK queue userId` → check current position | ⏳ |
| 3 | Turn reached | Remove from queue → allow entry to purchase page | 🎫 Admitted |
| 4 | Proceed to purchase | Stock deduction (Redis or DB) | ✅ / ❌ |

| Pros | Cons |
|------|------|
| Keeps server load constant | User waiting experience (UX cost) |
| Fair ordering guaranteed | High implementation complexity (queue + admission control + expiry) |
| Distributes traffic into two phases | Need to handle abandoned slots |

**Best for**: Tens of thousands of concurrent users, ticketing/booking systems where fair ordering matters

### 2.6 Token Issuance

**Core principle**: Issue entry tokens first, and only token holders can purchase. Traffic is completely separated into "token issuance" and "actual purchase" phases.

| Step | Client | Server | Status |
|:---:|--------|--------|:------:|
| 1 | Request token | Token server: issue tokens up to stock quantity → reject when exceeded | 🎟️ / ❌ |
| 2 | Purchase with token | Purchase server: validate token → deduct stock → create order | ✅ |
| 3 | | Mark token as expired/used | 🔒 |

| Pros | Cons |
|------|------|
| Purchase server doesn't get traffic spikes | Requires separate token server + purchase server |
| Token count = stock count → overselling impossible | Need token expiry/fraud prevention logic |
| Load distribution via server separation | User experience split into 2 steps |

**Best for**: Limited-edition sales, pre-orders, large-scale systems needing physical traffic separation

---

## 3. Side-by-Side Comparison

| Strategy | Throughput (TPS) | Complexity | Extra Infra | Data Consistency | Scale |
|----------|:---------------:|:----------:|:-----------:|:---------------:|:-----:|
| **DB Pessimistic Lock** | Low (tens~hundreds) | ⭐ | None | High | Small |
| **Redis DECR** | High (tens of thousands) | ⭐⭐ | Redis | Medium | Medium |
| **Redis + Lua** | High (tens of thousands) | ⭐⭐⭐ | Redis | High | Medium~Large |
| **Message Queue** | High (scalable) | ⭐⭐⭐⭐ | Kafka/RabbitMQ | High | Large |
| **Waiting Queue** | High (controllable) | ⭐⭐⭐⭐ | Redis | High | Large |
| **Token Issuance** | High (distributed) | ⭐⭐⭐⭐ | Token server | High | Large |

> Throughput isn't a simple number comparison. DB locks are low because they process "one at a time, in order." Redis strategies are high because they're "atomic without locks." Message queues and waiting queues are "scalable" because you can add consumers to adjust throughput.

---

## 4. How to Choose?

### Decision Flow

| Step | Question | Yes | No |
|:---:|---------|-----|-----|
| 1 | Are concurrent users a few dozen or less? | → **DB pessimistic lock** (done) | → Go to 2 |
| 2 | Can you add infrastructure (Redis)? | → Go to 3 | → **DB pessimistic lock** (done) |
| 3 | Is immediate response required? | → Go to 4 | → Go to 5 |
| 4 | Need duplicate prevention at the Redis level? | → **Redis + Lua** (done) | → **Redis DECR** (done) |
| 5 | Is fair waiting order (FCFS guarantee) important? | → **Waiting queue** (done) | → **Message queue** (done) |

> **Token issuance** is not a standalone strategy — it's a supplementary layer for bot prevention or traffic separation, combined with the strategies above. Example: waiting queue + token, Redis + Lua + token.

### Real Systems Combine Strategies

Production systems rarely use just one approach. Examples:

| System | Combination |
|--------|------------|
| Flash deals | **Waiting queue** (admission control) + **Redis** (stock deduction) |
| Concert ticketing | **Waiting queue** (ordering) + **Token** (entry rights) + **DB lock** (final payment) |
| Limited-edition sneakers | **Token issuance** (bot prevention) + **Redis + Lua** (stock deduction) |
| Small event coupons | **Redis DECR** alone is enough |

> The key question isn't "which strategy is best" but **"which fits our situation."** Bringing in Kafka for 50 concurrent users is over-engineering. Using only DB locks for 100,000 concurrent ticket buyers will crash your servers.

---

## Summary

| Key Point | Details |
|-----------|---------|
| **3 core problems of FCFS** | Concurrency control, accurate stock deduction, duplicate prevention |
| **6 strategies** | DB lock, Redis DECR, Redis + Lua, message queue, waiting queue, token issuance |
| **Choose by scale** | Small → DB lock, Medium → Redis, Large → queues/waiting/tokens |
| **Real systems combine** | Waiting queue + Redis, token + DB lock, etc. |
| **Avoid over-engineering** | Start with the simplest approach that fits your traffic and infrastructure |

The next post covers **Part 4: Implementing FCFS with DB Locks**. We'll start with the simplest approach, build it in code, and verify its limits with concurrency tests.
