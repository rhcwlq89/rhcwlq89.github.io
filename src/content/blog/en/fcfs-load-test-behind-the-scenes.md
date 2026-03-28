---
title: "Behind the FCFS Load Test: Pitfalls and Production Isolation Strategies"
description: "Problems we hit while k6-testing 4 FCFS strategies — Rate Limiter conflicts, queue over-counting bugs. Plus 4 ways to isolate FCFS APIs from regular APIs in production: separate DataSource, Redis offloading, service separation, and Bulkhead pattern."
pubDate: "2026-03-25T14:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Load Testing", "k6", "Spring Boot", "Behind the Scenes"]
heroImage: "../../../assets/FcfsLoadTestComparison.png"
lang: en
---

## Introduction

In [Part 8](/blog/en/fcfs-load-test-comparison), we load-tested all four FCFS approaches with k6 and compared their performance. This post covers **what we built to make those tests work, what problems we ran into, and how production environments should handle things differently.**

---

## 1. Isolation Design — Don't Touch Existing Code

`marketplace` is a project with existing order flows, authentication, and middleware already in place. Mixing experimental FCFS code into that could affect existing behavior.

The solution: create a separate `com.example.marketplace.fcfs` package to fully isolate all four strategies.

```
marketplace-api/src/main/kotlin/com/example/marketplace/fcfs/
├── controller/   (5: DbLockController, RedisController, QueueController, TokenController, ResetController)
├── service/      (4: one per strategy)
├── dto/          (4: request/response DTOs)
├── entity/       (FcfsOrder — lightweight order entity)
├── repository/   (FcfsOrderRepository)
└── config/       (Lua script bean configuration)
```

Three design principles guided this:

**1. Reuse existing entities where possible.** The `Product` entity's `stock` field is used as-is. The DB lock test runs actual `SELECT FOR UPDATE` against it.

**2. `FcfsOrder` is a lightweight entity.** The existing `Order` has payment, shipping, and coupon fields layered on. For FCFS testing, we only need `userId`, `productId`, `status`, and `createdAt`.

**3. Add `permitAll` for FCFS endpoints.** k6 calls these endpoints directly without authentication headers. We added `/api/orders/db-lock/**`, `/api/orders/redis/**`, `/api/queue/**`, `/api/tokens/**`, and `/api/fcfs/**` to the `SecurityConfig` permit list.

We also added a **reset endpoint**:

```
POST /api/fcfs/reset
```

Before each test run, stock needs to reset to 100, Redis keys need to clear, and the `FcfsOrder` table needs to empty. Doing this manually invites mistakes. One reset call handles all of it.

---

## 2. Issue 1 — Resilience4j Rate Limiter

After finishing the implementation, the first k6 run showed **zero successes for the token strategy.**

```
✗ status is 200 or 409
↳  0% — ✓ 0 / ✗ 100
```

Every response was `429 RATE_LIMITED`. Initial assumption: a k6 configuration problem. But direct `curl` calls to the endpoint also returned 429.

**The cause was `RateLimitingFilter`.**

`marketplace` already had a Resilience4j-based Rate Limiter attached — it limits order creation APIs to 100 requests per second. The filter applied to **all paths** by default.

The token strategy flow is:
1. Phase 1: Issue token (`POST /api/tokens/issue`) × 100 requests
2. Phase 2: Purchase with token (`POST /api/orders/token`) × 100 requests

When k6 executed Phase 1 and Phase 2 in rapid succession, the 100 Phase 2 purchase requests exceeded the Rate Limiter's threshold. All purchase requests got blocked with 429.

The DB lock test where only 99 out of 100 succeeded? Same cause. One request hit the Rate Limiter.

**The fix: add FCFS paths to `shouldNotFilter`.**

```kotlin
override fun shouldNotFilter(request: HttpServletRequest): Boolean {
    val path = request.requestURI
    return path.startsWith("/actuator") ||
            path.startsWith("/api/products") ||
            path.startsWith("/api/auth") ||
            path.startsWith("/api/orders/db-lock") ||
            path.startsWith("/api/orders/redis") ||
            path.startsWith("/api/orders/token") ||
            path.startsWith("/api/queue") ||
            path.startsWith("/api/tokens") ||
            path.startsWith("/api/fcfs")
}
```

Tests ran correctly after this change.

**Lesson**: When load tests produce unexpected failures, check **application-level protection mechanisms first** — Rate Limiter, Circuit Breaker, Bulkhead. These silently distort test results. Looking at 429/503 responses in the server log is faster than debugging k6 configuration for 30 minutes.

---

## 3. Issue 2 — Queue Test: 185 Successes for 100 Stock

Stock was 100. The k6 report showed 185 successes.

```
success_count: 185
fail_count:    815
```

Suspected a bug — maybe duplicate processing in the Redis Sorted Set or Kafka Consumer. Checked the actual DB:

```sql
SELECT COUNT(*) FROM fcfs_orders WHERE status = 'COMPLETED';
-- Result: 100
```

Exactly 100 rows in the DB. So why did k6 count 185 as successful?

**The k6 script had the wrong definition of "success."**

The queue strategy flow:
1. Enter queue (`POST /api/queue/enter`)
2. Poll for status (`GET /api/queue/status`) — wait until `ALLOWED` or `NOT_IN_QUEUE`
3. Attempt purchase (`POST /api/orders`)

The Kafka Consumer's `consumeQueueOrder` was updating a user's status to `COMPLETED` even when the stock deduction Lua script returned `0` — meaning no stock remaining. The intent was "this request has been processed," but the k6 polling script was reading `COMPLETED` as "purchase succeeded."

**Users who failed to claim stock were being counted as successes.**

Two fixes:
1. In the Kafka Consumer, update status to `FAILED` when stock deduction returns 0
2. In the k6 polling script, count only `COMPLETED` as success; `FAILED` and `NOT_IN_QUEUE` count as failure

After these fixes, the queue test reported exactly 100 successes.

**Core point**: In a queue-based approach, "entry permitted" and "purchase successful" are different states. When async flows are involved, **the definition of "success" must be consistent between the server code and the test script.** If they disagree, the measurement is invalid.

---

## 4. Production Concern — Isolating FCFS APIs from Regular APIs

In the test environment, only FCFS APIs ran. In production, **product listings, user pages, and payments** all run simultaneously. If FCFS traffic spikes bring down regular APIs, the entire service is down.

### 4.1 The Problem: Shared DB Connection Pool

The core issue with DB locks: `SELECT FOR UPDATE` **holds a connection while waiting for the lock**. If 10 FCFS requests grab all 10 HikariCP connections, even a simple product listing query can't get a connection and times out.

```
[10 FCFS requests] → Connection pool (10) fully occupied
[Product listing]  → Waiting for connection → Timeout → 503 Error
```

### 4.2 Solution 1: Separate DataSources

The most reliable approach: **create a dedicated DataSource for FCFS**.

```kotlin
@Configuration
class DataSourceConfig {

    @Primary
    @Bean
    @ConfigurationProperties("spring.datasource.main")
    fun mainDataSource(): DataSource = HikariDataSource()

    @Bean
    @ConfigurationProperties("spring.datasource.fcfs")
    fun fcfsDataSource(): DataSource = HikariDataSource()
}
```

```yaml
spring:
  datasource:
    main:
      maximum-pool-size: 20   # For regular APIs
    fcfs:
      maximum-pool-size: 10   # Dedicated to FCFS
```

Even if FCFS requests consume all 10 `fcfsDataSource` connections, regular APIs independently use the 20 `mainDataSource` connections.

### 4.3 Solution 2: Redis Offloading (Recommended)

Part 8's test results already showed the answer. **Moving stock deduction to Redis eliminates DB connection contention entirely.**

```
[FCFS request] → Redis (DECR) → Only on success: DB INSERT (1 connection, brief)
[Regular API]  → DB connection pool (plenty of room)
```

Redis and token approaches don't use DB connections for stock deduction, so FCFS traffic and regular traffic **don't interfere at the DB level**.

### 4.4 Solution 3: Service Separation (Large Scale)

For high traffic, splitting the FCFS API into a **separate service** is the cleanest approach.

```
[Nginx / ALB]
├── /api/orders/fcfs/** → FCFS Service (separate instances, separate DB pool)
└── /api/**             → Main Service (existing instances)
```

- FCFS scaling is independent
- FCFS failures don't cascade to the main service
- Higher infra cost, but this isolation is essential at scale

### 4.5 Solution 4: Bulkhead Pattern

If service separation is overkill but you want connection pool isolation, **Resilience4j Bulkhead** limits concurrent execution.

```kotlin
@Bulkhead(name = "fcfsApi", fallbackMethod = "fcfsFallback")
fun purchase(request: FcfsRequest): FcfsResponse {
    // ...
}
```

```yaml
resilience4j:
  bulkhead:
    instances:
      fcfsApi:
        max-concurrent-calls: 10    # Max 10 concurrent FCFS requests
        max-wait-duration: 500ms    # Excess waits 500ms then fails
```

This prevents FCFS APIs from holding more than 10 DB connections at any time.

### 4.6 Summary: Recommendations by Scale

| Scale | Recommended Isolation |
|-------|----------------------|
| **Small (~100 concurrent)** | Bulkhead to limit concurrency |
| **Medium (~1,000 concurrent)** | Redis offloading + Bulkhead |
| **Large (~10,000+ concurrent)** | Service separation + Redis + Queue |

---

## 5. What the Test Environment Does to Results

These numbers shouldn't be taken at face value.

Local testing limitations:
- MySQL, Redis, Kafka, and the app server all run on the same machine — network latency is 0
- k6 runs on the same machine — the test tool itself competes for CPU
- No firewalls, load balancers, or connection limits from a real production setup

The tests are still valid because **the comparison baseline is the same for all approaches.** All four strategies ran under identical conditions. So "token is faster than Redis in this environment" is a valid comparison. But "TPS 2,736" as an absolute number may not hold in production.

**The goal is relative comparison between approaches, not absolute numbers.**

---

## Summary

Key takeaways:

1. **Existing protection mechanisms in the test environment will bite you.** One Rate Limiter caused the token strategy to show 0% success. When adding new endpoints, revisit the existing filter and interceptor list.

2. **In async flows, define "success" explicitly in both server code and test scripts.** The queue's `COMPLETED` state needed to distinguish "purchase succeeded" from "request processed." When those definitions diverge, the measurement breaks.

3. **In production, isolation is everything.** When FCFS traffic spikes, regular APIs must not go down with it. Redis offloading, separate DataSources, Bulkhead, service separation — pick the isolation strategy that fits your scale.

4. **Acknowledge the limits of local testing.** All numbers are relative comparisons on the same machine. No network latency, no connection pool sharing, no competing APIs. DB lock performance would be significantly worse in production.

- Previous: [Part 8 — FCFS System Showdown: Load Testing All Approaches](/blog/en/fcfs-load-test-comparison)
- Next: [7 Practical Patterns for java.util.concurrent](/blog/en/java-concurrent-practical-patterns)
