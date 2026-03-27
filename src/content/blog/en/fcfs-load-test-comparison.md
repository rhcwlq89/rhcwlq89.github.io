---
title: "FCFS System Showdown: Load Testing All Approaches with k6"
description: "Compares DB locks, Redis, queues, and tokens — four FCFS implementations tested with k6 under identical conditions (100 stock, 100/500/1000 concurrent users). Measures TPS, P95 latency, and failure rate, then provides a decision matrix for choosing the right approach."
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
| Application | Spring Boot 3.x, Java 17 (running locally) |
| DB | MySQL 8.0 (InnoDB) |
| Redis | Redis 7.x (Standalone) |
| Kafka | Apache Kafka 3.x (1 broker, 3 partitions) |
| Load test tool | k6 v1.5.0 |
| HikariCP | maxPoolSize: 20, connectionTimeout: 30s |

> Infrastructure (MySQL, Redis, Kafka) ran via Docker Compose; the application ran locally.

### 1.2 Test Scenarios

Identical conditions for all approaches:

- **Stock**: 100 items
- **Concurrent users**: 100 / 500 / 1,000
- **Request pattern**: All users attempt purchase simultaneously (no ramp-up)
- **Metrics**: TPS, avg response time, P95 response time, success rate, failure rate

### 1.3 Measurement Method

Each approach's **"stock deduction API"** is called directly:

| Approach | Endpoint |
|----------|----------|
| DB Lock | `POST /api/orders/db-lock` |
| Redis | `POST /api/orders/redis` |
| Queue | `POST /api/queue/enter` + polling + `POST /api/orders` |
| Token | `POST /api/tokens/issue` + `POST /api/orders/token` |

> Queue and token approaches involve 2-step calls, so we measure **total elapsed time for the entire flow**.

State was reset between tests using `POST /api/fcfs/reset` to restore stock and clear Redis.

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
            vus: __ENV.VUS ? parseInt(__ENV.VUS) : 100,
            iterations: __ENV.ITERATIONS ? parseInt(__ENV.ITERATIONS) : 100,
            maxDuration: '120s',
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
            vus: __ENV.VUS ? parseInt(__ENV.VUS) : 100,
            iterations: __ENV.ITERATIONS ? parseInt(__ENV.ITERATIONS) : 100,
            maxDuration: '120s',
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

> **Measured data (2026.03.27)** — All figures are from actual test runs.

### 3.1 100 Concurrent Users (100 Stock)

```bash
k6 run -e VUS=100 -e ITERATIONS=100 test-db-lock.js
```

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 1.2s | 0.6s | ~30s | 2.3s |
| Avg response | 324ms | 487ms | ~16s (incl. polling) | 251ms |
| P95 response | 544ms | 524ms | ~30s | 283ms |
| Success | 100 | 100 | 100 | 100 |
| Failed | 0 | 0 | 0 | 0 |

> The queue takes ~30s because the scheduler allows 10 users every 3 seconds. This isn't a performance problem — it's **intentional flow control**.

### 3.2 500 Concurrent Users (100 Stock)

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 1.8s | 1.1s | ~31s | 1.2s |
| Avg response | 1,513ms | 1,017ms | ~5.5s (incl. polling) | 937ms |
| P95 response | 1,754ms | 1,068ms | ~25s | 1,099ms |
| Success | 100 | 100 | 100 | 100 |
| Failed (sold out) | 400 | 400 | 400 | 400 |
| TPS | ~278 | ~455 | N/A | ~417 |

At 500 users, DB lock P95 climbs to 1.7 seconds — noticeable, but not catastrophic. No HikariCP timeouts were observed. The gap between Redis and token is also smaller than expected at this scale.

### 3.3 1,000 Concurrent Users (100 Stock)

| Metric | DB Lock | Redis | Queue | Token |
|--------|---------|-------|-------|-------|
| Total time | 1.3s | 0.2s | ~56s | 0.3s |
| Avg response | 826ms | 202ms | ~10s (incl. polling) | 117ms |
| P95 response | 1,165ms | 302ms | ~41s | 197ms |
| Success | 100 | 100 | 185* | 100 |
| Failed (sold out) | 900 | 900 | 815 | 900 |
| TPS | ~783 | ~2,008 | N/A | ~2,736 |

> \* The queue showing 185 successes instead of 100 is a known issue. The Kafka consumer continued marking queue entries as COMPLETED even after stock was exhausted, allowing those requests to reach the purchase API. Stock deduction itself was precisely capped at 100.

---

## 4. Analysis

### 4.1 TPS Comparison

```
TPS (1,000 concurrent users)
──────────────────────────────────────────────

DB Lock    ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  783
Redis      ████████████████████████████████████████  2,008
Token      ████████████████████████████████████████████  2,736
Queue      (flow control — not comparable by TPS)
```

At 1,000 users, **token outperforms Redis** (2,736 vs 2,008 TPS). Token isn't just for bot prevention — it also delivers the highest raw throughput under load.

### 4.2 P95 Latency Comparison

```
P95 Response Time (1,000 concurrent)
──────────────────────────────────────────────

DB Lock    ██████░░░░░░░░░░░░░░░░░░░░░░░░░  1,165ms
Redis      ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░  302ms
Token      █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  197ms
Queue      Intentional wait (~41s)
```

### 4.3 DB Connection Behavior

DB locks make **every request hold a DB connection while waiting for the lock**. This means even unrelated APIs (product listings, user pages) can't get connections, slowing down the **entire service**. Redis/token approaches don't use DB for stock deduction — one connection is enough.

That said, DB lock performed better than expected. Even at 1,000 users, P95 was 1.2 seconds and no HikariCP timeouts appeared. Low network latency and fast DB response in the local environment likely contributed. Production systems sharing connections with other APIs could see worse results.

---

## 5. Cost-Performance Analysis

### 5.1 Infrastructure Cost

| Approach | Required Infrastructure | Est. Monthly Cost (AWS) |
|----------|----------------------|------------------------|
| DB Lock | MySQL only | ~$50 (RDS db.t3.medium) |
| Redis | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |
| Queue | MySQL + Redis + Kafka | ~$200 (+ MSK t3.small) |
| Token | MySQL + Redis | ~$80 (+ ElastiCache t3.small) |

### 5.2 TPS per Dollar

| Approach | TPS | Monthly Cost | TPS/$ |
|----------|-----|-------------|-------|
| DB Lock | 783 | $50 | 15.66 |
| Redis | 2,008 | $80 | 25.10 |
| Token | 2,736 | $80 | 34.20 |
| Queue | N/A (flow control) | $200 | N/A |

**Token leads on cost efficiency.** At $80, it delivers 2,736 TPS — 36% more throughput than Redis at the same price.

---

## 6. Choosing the Right Approach

### 6.1 Traffic Scale × Infrastructure Matrix

| | Minimal Infra | Redis Available | Redis + Kafka Available |
|---|:---:|:---:|:---:|
| **~50 concurrent** | ✅ DB Lock | DB Lock is fine | Overengineered |
| **~500 concurrent** | ⚠️ DB Lock (tune pool) | ✅ Redis | Overengineered |
| **~5,000 concurrent** | ❌ | ✅ Redis or Token | ✅ Redis |
| **~50,000 concurrent** | ❌ | ⚠️ Redis (UX issue) | ✅ Queue + Token |
| **~100,000+ concurrent** | ❌ | ❌ | ✅ Queue + Token + horizontal scaling |

### 6.2 Recommendations by Scenario

**"Internal company event, small-scale FCFS (~50 concurrent)"**
→ **DB Lock** — No extra infrastructure needed. Fast enough.

**"E-commerce limited sale, mid-scale (~hundreds to thousands)"**
→ **Redis Lua Script** — 2.5x performance for $30 more. Simple to implement.

**"Sneaker drop, large-scale (~thousands to tens of thousands)"**
→ **Token + Redis** — Fastest at high load (2,736 TPS), enables bot prevention, best cost efficiency.

**"Concert ticketing, massive-scale (~tens of thousands+)"**
→ **Queue + Token + Kafka** — Order guarantee + traffic absorption + stable processing.

### 6.3 Decision Flowchart

```
Is concurrent traffic under 100?
├─ Yes → DB Lock
└─ No
    └─ Need to show users their queue position?
        ├─ Yes → Queue (+ token combo recommended)
        └─ No
            └─ Need bot prevention or maximum throughput?
                ├─ Yes → Token + Redis
                └─ No → Redis Lua Script
```

---

## 7. Reproducing These Tests

Want to run the tests yourself?

### 7.1 Install k6

```bash
brew install k6
```

### 7.2 Vary Concurrent Users

```bash
# 100 users
k6 run -e VUS=100 -e ITERATIONS=100 test-db-lock.js

# 500 users
k6 run -e VUS=500 -e ITERATIONS=500 test-db-lock.js

# 1,000 users
k6 run -e VUS=1000 -e ITERATIONS=1000 test-db-lock.js
```

### 7.3 Generate Reports

```bash
k6 run --out json=result.json test-db-lock.js
# Visualize with k6 Cloud or Grafana
```

### 7.4 Important Notes

- **Reset state**: Call `POST /api/fcfs/reset` before each test to restore stock and clear Redis
- **JVM warmup**: First run may be slow due to JIT compilation. Use results from runs 2-3
- **Network**: Place k6 and server on the same network to avoid network latency skewing results

For a walkthrough of how this test environment was built, see [Part 9](/blog/en/fcfs-load-test-behind-the-scenes).

---

## Summary

| Approach | TPS (1,000) | P95 | Cost | Best For |
|----------|:---:|:---:|:---:|----------|
| **DB Lock** | 783 | 1,165ms | $50 | Internal events (~50) |
| **Redis** | 2,008 | 302ms | $80 | Mid-scale FCFS (~thousands) |
| **Token** | 2,736 | 197ms | $80 | Large-scale + bot prevention + max throughput |
| **Queue** | Flow control | ~41s (intentional) | $200 | Massive-scale ticketing |

**Key Takeaways:**

1. **DB lock performed better than expected.** P95 of 1.2s at 1,000 users, no HikariCP timeouts. Production results may differ when connections are shared with other APIs.
2. **Token is the fastest at high concurrency.** 2,736 TPS beats Redis (2,008). It's not just for bot prevention — it's also the highest raw throughput.
3. **Redis is still a great choice.** $30 more for 2.5x performance, and the implementation is straightforward.
4. **Queue is about experience, not performance.** The ~30s response time is constant regardless of load — that's the point.
5. **The real story: the gap narrows under load.** The difference between strategies was smaller than predicted, which is a useful reality check for capacity planning.

This series covered **FCFS systems from fundamentals to production**. From transaction isolation levels in Part 1 to load testing in Part 8, we built each approach and measured the results. The goal was always the same: **make technology choices backed by evidence, not assumptions.**
