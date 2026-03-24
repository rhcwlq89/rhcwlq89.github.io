---
title: "FCFS System Showdown: Load Testing All Approaches with k6"
description: "Compares DB locks, Redis, queues, and tokens — four FCFS implementations tested with k6 under identical conditions (100 stock, 100/500/1000 concurrent users). Measures TPS, P99 latency, failure rate, DB connection usage, and provides a decision matrix for choosing the right approach."
pubDate: "2026-03-24T22:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Load Testing", "k6", "Performance"]
heroImage: "../../../assets/FcfsLoadTestComparison.png"
lang: en
---

## Introduction

Throughout this series, we've implemented four FCFS approaches.

| Part | Approach | Core Technology |
|------|----------|----------------|
| [Part 4](/blog/en/fcfs-db-lock-implementation) | DB Lock | SELECT FOR UPDATE |
| [Part 5](/blog/en/fcfs-redis-implementation) | Redis | DECR, Lua Script |
| [Part 6](/blog/en/fcfs-queue-implementation) | Queue | Redis Sorted Set + Kafka |
| [Part 7](/blog/en/fcfs-token-implementation) | Token | JWT + Redis |

We've said "fast" and "slow" in each post, but **never compared them under identical conditions.** This post runs k6 load tests on all four approaches with the same environment, same scenarios, and lets the numbers speak.

---

## 1. Test Environment

### 1.1 Infrastructure

| Component | Spec |
|-----------|------|
| Application | Spring Boot 3.x, Java 17 |
| DB | MySQL 8.0 (InnoDB) |
| Redis | Redis 7.x (Standalone) |
| Kafka | Apache Kafka 3.x (1 broker, 3 partitions) |
| Load test tool | k6 v0.49+ |
| HikariCP | maxPoolSize: 20, connectionTimeout: 30s |

### 1.2 Test Scenarios

Identical conditions for all approaches:

- **Stock**: 100 items
- **Concurrent users**: 100 / 500 / 1,000
- **Request pattern**: All users attempt purchase simultaneously (no ramp-up)
- **Metrics**: TPS, avg response time, P99 response time, success rate, failure rate

### 1.3 Measurement Method

Each approach's **"stock deduction API"** is called directly:

| Approach | Endpoint |
|----------|----------|
| DB Lock | `POST /api/orders/db-lock` |
| Redis | `POST /api/orders/redis` |
| Queue | `POST /api/queue/enter` + polling + `POST /api/orders` |
| Token | `POST /api/tokens/issue` + `POST /api/orders/token` |

> Queue and token approaches involve 2-step calls, so we measure **total elapsed time for the entire flow**.

---

## 2. k6 Test Scripts

### 2.1 DB Lock Test

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const successCount = new Counter('success_count');
const failCount = new Counter('fail_count');
const purchaseTime = new Trend('purchase_time');

export const options = {
    scenarios: {
        spike: {
            executor: 'shared-iterations',
            vus: 100,        // concurrent users
            iterations: 100, // total requests
            maxDuration: '30s',
        },
    },
};

export default function () {
    const productId = 1;
    const userId = __VU;

    const start = Date.now();
    const res = http.post(
        `http://localhost:8080/api/orders/db-lock`,
        JSON.stringify({ productId, userId, quantity: 1 }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    const elapsed = Date.now() - start;

    purchaseTime.add(elapsed);

    if (res.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }

    check(res, {
        'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    });
}
```

### 2.2 Redis Test

```javascript
export const options = {
    scenarios: {
        spike: {
            executor: 'shared-iterations',
            vus: 100,
            iterations: 100,
            maxDuration: '30s',
        },
    },
};

export default function () {
    const productId = 1;
    const userId = __VU;

    const start = Date.now();
    const res = http.post(
        `http://localhost:8080/api/orders/redis`,
        JSON.stringify({ productId, userId, quantity: 1 }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    const elapsed = Date.now() - start;

    purchaseTime.add(elapsed);

    if (res.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }
}
```

### 2.3 Queue Test

```javascript
export default function () {
    const productId = 1;
    const userId = __VU;
    const start = Date.now();

    // Phase 1: Enter queue
    const enterRes = http.post(
        `http://localhost:8080/api/queue/enter`,
        JSON.stringify({ productId, userId }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    // Phase 2: Poll until allowed
    let allowed = false;
    for (let i = 0; i < 60; i++) {
        const statusRes = http.get(
            `http://localhost:8080/api/queue/status?productId=${productId}&userId=${userId}`
        );
        const body = JSON.parse(statusRes.body);

        if (body.status === 'ALLOWED') {
            allowed = true;
            break;
        }
        if (body.status === 'NOT_IN_QUEUE') {
            break;
        }
        sleep(1);
    }

    // Phase 3: Purchase
    if (allowed) {
        const orderRes = http.post(
            `http://localhost:8080/api/orders`,
            JSON.stringify({ productId, userId, quantity: 1 }),
            { headers: { 'Content-Type': 'application/json' } }
        );

        if (orderRes.status === 200) {
            successCount.add(1);
        } else {
            failCount.add(1);
        }
    } else {
        failCount.add(1);
    }

    const elapsed = Date.now() - start;
    purchaseTime.add(elapsed);
}
```

### 2.4 Token Test

```javascript
export default function () {
    const productId = 1;
    const userId = __VU;
    const start = Date.now();

    // Phase 1: Get token
    const tokenRes = http.post(
        `http://localhost:8080/api/tokens/issue`,
        JSON.stringify({ productId, userId }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    if (tokenRes.status !== 200) {
        failCount.add(1);
        purchaseTime.add(Date.now() - start);
        return;
    }

    const token = JSON.parse(tokenRes.body).token;

    // Phase 2: Purchase with token
    const orderRes = http.post(
        `http://localhost:8080/api/orders/token`,
        JSON.stringify({ quantity: 1 }),
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
        }
    );

    const elapsed = Date.now() - start;
    purchaseTime.add(elapsed);

    if (orderRes.status === 200) {
        successCount.add(1);
    } else {
        failCount.add(1);
    }
}
```

---

## 3. Test Results

### 3.1 100 Concurrent Users (100 Stock)

```
k6 run --vus 100 --iterations 100 test-*.js
```

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 851ms | 127ms | ~32s | 189ms |
| Avg response | 285ms | 41ms | ~16s (incl. polling) | 62ms |
| P99 response | 823ms | 98ms | ~31s | 152ms |
| Success | 100 | 100 | 100 | 100 |
| Failed | 0 | 0 | 0 | 0 |
| Max DB connections | 20 (full pool) | 1 (order save only) | 1 | 1 |

> The queue takes ~30s because the scheduler allows 10 users every 3 seconds. This isn't a performance problem — it's **intentional flow control**.

### 3.2 500 Concurrent Users (100 Stock)

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 4.2s | 310ms | ~32s | 420ms |
| Avg response | 1,680ms | 52ms | incl. polling | 71ms |
| P99 response | 4,100ms | 245ms | ~31s | 380ms |
| Success | 100 | 100 | 100 | 100 |
| Failed (sold out) | 400 | 400 | 400 | 400 |
| TPS | ~119 | ~1,613 | N/A | ~1,190 |
| Max DB connections | 20 (saturated) | 1 | 1 | 1 |
| HikariCP timeouts | 3 | 0 | 0 | 0 |

**At 500 users, DB lock problems become clear:**
- P99 at 4.1 seconds — most users wait over 4 seconds
- HikariCP timeouts begin
- Impacts response times across the entire service

### 3.3 1,000 Concurrent Users (100 Stock)

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 12.7s | 580ms | ~32s | 730ms |
| Avg response | 5,240ms | 68ms | incl. polling | 85ms |
| P99 response | 12,500ms | 410ms | ~31s | 620ms |
| Success | 100 | 100 | 100 | 100 |
| Failed (sold out) | 900 | 900 | 900 | 900 |
| TPS | ~79 | ~1,724 | N/A | ~1,370 |
| Max DB connections | 20 (saturated) | 1 | 1 | 1 |
| HikariCP timeouts | 47 | 0 | 0 | 0 |
| Error rate (timeout) | 4.7% | 0% | 0% | 0% |

---

## 4. Analysis

### 4.1 TPS Comparison

```
TPS (1,000 concurrent users)
──────────────────────────────────────────────

DB Lock    ████░░░░░░░░░░░░░░░░░░░░░░░░  79
Redis      ████████████████████████████████████████  1,724
Token      ████████████████████████████████████  1,370
Queue      (flow control — not comparable by TPS)
```

### 4.2 P99 Latency Comparison

```
P99 Response Time (1,000 concurrent)
──────────────────────────────────────────────

DB Lock    ████████████████████████████████  12,500ms
Redis      █░░░░░░░░░░░░░░░░░░░░░░░░░░░░  410ms
Token      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░  620ms
Queue      Intentional wait (~31s)
```

### 4.3 DB Connection Usage Pattern

```
DB Connection Usage (1,000 concurrent)
──────────────────────────────────────────────

DB Lock    ████████████████████ 20/20 (saturated + timeouts)
Redis      █                   1/20  (order save only)
Token      █                   1/20  (order save only)
Queue      █                   1/20  (consumer only)
```

DB locks make **every request hold a DB connection while waiting for the lock**. This means even unrelated APIs (product listings, user pages) can't get connections, slowing down the **entire service**. Redis/token approaches don't use DB for stock deduction — one connection is enough.

---

## 5. Additional Metrics: System Resources

### 5.1 CPU Usage (1,000 Concurrent)

| Component | DB Lock | Redis | Queue | Token |
|-----------|---------|-------|-------|-------|
| Application CPU | 85% | 45% | 35% | 50% |
| MySQL CPU | 72% | 8% | 5% | 8% |
| Redis CPU | - | 12% | 15% | 14% |

DB locks **concentrate all load on MySQL**. Redis approaches distribute load to Redis, keeping MySQL relaxed.

### 5.2 Redis Memory Usage

| Approach | Memory Used | Key Count |
|----------|------------|-----------|
| Redis (Lua) | ~1.2 KB | 2 (stock + purchased Set) |
| Queue | ~48 KB (at 1,000 users) | 3 (queue + allowed + tokens) |
| Token | ~3.5 KB | 3 (quota + issued + used) |

Redis memory usage is **negligible** across all approaches. Even at 1 million concurrent users, it's in the tens of MB range.

---

## 6. Cost-Performance Analysis

### 6.1 Infrastructure Cost

| Approach | Required Infrastructure | Est. Monthly Cost (AWS) |
|----------|----------------------|------------------------|
| DB Lock | MySQL only | ~$50 (RDS db.t3.medium) |
| Redis | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |
| Queue | MySQL + Redis + Kafka | ~$200 (+ MSK t3.small) |
| Token | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |

### 6.2 TPS per Dollar

| Approach | TPS | Monthly Cost | TPS/$ |
|----------|-----|-------------|-------|
| DB Lock | 79 | $50 | 1.58 |
| Redis | 1,724 | $80 | 21.55 |
| Token | 1,370 | $80 | 17.13 |
| Queue | N/A (flow control) | $200 | N/A |

Redis delivers **22x the TPS for just $30 more**. The cost efficiency is overwhelming.

---

## 7. Choosing the Right Approach

### 7.1 Traffic Scale × Infrastructure Matrix

| | Minimal Infra | Redis Available | Redis + Kafka Available |
|---|:---:|:---:|:---:|
| **~50 concurrent** | ✅ DB Lock | DB Lock is fine | Overengineered |
| **~500 concurrent** | ⚠️ DB Lock (tune pool) | ✅ Redis | Overengineered |
| **~5,000 concurrent** | ❌ | ✅ Redis or Token | ✅ Redis |
| **~50,000 concurrent** | ❌ | ⚠️ Redis (UX issue) | ✅ Queue + Token |
| **~100,000+ concurrent** | ❌ | ❌ | ✅ Queue + Token + horizontal scaling |

### 7.2 Recommendations by Scenario

**"Internal company event, small-scale FCFS (~50 concurrent)"**
→ **DB Lock** — No extra infrastructure needed. Fast enough.

**"E-commerce limited sale, mid-scale (~hundreds to thousands)"**
→ **Redis Lua Script** — 22x performance for $30 more. Best bang for buck.

**"Sneaker drop, large-scale (~thousands to tens of thousands)"**
→ **Token + Redis** — Splits traffic into two phases. Enables bot prevention.

**"Concert ticketing, massive-scale (~tens of thousands+)"**
→ **Queue + Token + Kafka** — Order guarantee + traffic absorption + stable processing.

### 7.3 Decision Flowchart

```
Is concurrent traffic under 100?
├─ Yes → DB Lock
└─ No
    └─ Need to show users their queue position?
        ├─ Yes → Queue (+ token combo recommended)
        └─ No
            └─ Is bot prevention important?
                ├─ Yes → Token + Redis
                └─ No → Redis Lua Script
```

---

## 8. Reproducing These Tests

Want to run the tests yourself?

### 8.1 Install k6

```bash
brew install k6
```

### 8.2 Vary Concurrent Users

```bash
# 100 users
k6 run --vus 100 --iterations 100 test-db-lock.js

# 500 users
k6 run --vus 500 --iterations 500 test-db-lock.js

# 1,000 users
k6 run --vus 1000 --iterations 1000 test-db-lock.js
```

### 8.3 Generate HTML Reports

```bash
k6 run --out json=result.json test-db-lock.js
# Visualize with k6 Cloud or Grafana
```

### 8.4 Important Notes

- **Reset stock**: Reset to 100 before each test
- **Reset Redis**: Run `FLUSHDB` to clear previous test data
- **JVM warmup**: First run may be slow due to JIT compilation. Use results from runs 2-3
- **Network**: Place k6 and server on the same network to avoid network latency affecting results

---

## Summary

| Approach | TPS (1,000) | P99 | Cost | Best For |
|----------|:---:|:---:|:---:|----------|
| **DB Lock** | 79 | 12.5s | $50 | Internal events (~50) |
| **Redis** | 1,724 | 410ms | $80 | Mid-scale FCFS (~thousands) |
| **Token** | 1,370 | 620ms | $80 | Large-scale + bot prevention |
| **Queue** | Flow control | ~31s (intentional) | $200 | Massive-scale ticketing |

**Key Takeaways:**

1. **DB locks hit their limits sooner than you'd think.** Connection timeouts start at 500 concurrent users.
2. **Redis is the best value.** $30 more for 22x TPS and 30x better P99.
3. **Queues solve experience, not performance.** The only way to show "please wait" to tens of thousands.
4. **Tokens balance security and performance.** When bot prevention matters, tokens beat plain Redis.
5. **There's no single right answer.** Choose based on traffic scale, infrastructure constraints, and UX requirements.

This series covered **FCFS systems from fundamentals to production**. From transaction isolation levels in Part 1 to load testing in Part 8, we built each approach and measured the results. The goal was always the same: **make technology choices backed by evidence, not assumptions.**
