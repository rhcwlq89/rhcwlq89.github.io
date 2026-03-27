---
title: "Behind the FCFS Load Test: Actually Running What We Wrote About"
description: "We admitted the load test numbers were estimates and actually built all 4 FCFS strategies to run k6 tests for real. From isolated package design to Rate Limiter conflicts and queue over-counting bugs — what actually happens when you run the tests."
pubDate: "2026-03-25T14:00:00+09:00"
tags: ["System Design", "First-Come-First-Served", "Load Testing", "k6", "Spring Boot", "Behind the Scenes"]
heroImage: "../../../assets/FcfsLoadTestComparison.png"
lang: en
---

## Introduction — Why This Post Exists

In [Part 8](/blog/en/fcfs-load-test-comparison), we presented performance comparison numbers for all four FCFS approaches — TPS, P99 latency, DB connection usage, neatly laid out in tables.

Those numbers were not from actual test runs.

To be honest:

- The `marketplace` project had no `/api/orders/db-lock` endpoint
- No k6 script files existed
- Success was exactly 100, failure was exactly 400 — the numbers were suspiciously clean

We wrote Part 8 based on what we reasoned would happen theoretically, without actually building and running the tests. The direction was probably right. The magnitudes could be wrong.

So we went back and built all four strategies for real, wrote the k6 scripts, ran them, and updated Part 8 with actual measured data.

This post is a record of **what we built, and what broke along the way.**

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

## 4. Issue 3 — Results That Didn't Match Predictions

With both issues resolved, we ran the 1,000-user test again. Comparing Part 8's estimates against actual measurements:

| Metric | Part 8 Estimate | Actual | Difference |
|--------|----------------|--------|------------|
| DB Lock P95 (1,000 users) | 12,500ms | 1,165ms | **10x faster** |
| DB Lock TPS (1,000 users) | 79 | 783 | **10x higher** |
| Redis TPS (1,000 users) | 1,724 | 2,008 | ~16% higher |
| Token TPS (1,000 users) | 1,370 | 2,736 | **2x higher** |
| Redis vs Token ranking | Redis > Token | **Token > Redis** | reversed |

DB lock being 10x faster than predicted was surprising at first — but the reason makes sense.

**Why DB lock was faster than expected**: The Part 8 estimates assumed a production-like environment — ~1ms network round-trip between RDS and the application server, hundreds of concurrent connections. In local testing, MySQL runs on the same machine. No network round-trip. HikariCP's pool of 20 connections returns fast on local hardware. The absolute numbers differ significantly, but **the gap would widen further in a real production environment.**

**Why token outperformed Redis**: The token strategy's Redis operations are just `DECR` and `SISMEMBER`. The Redis Lua script bundles multiple commands together, introducing additional overhead. JWT signing and verification are CPU operations with no I/O wait. Locally, CPU-bound work completes faster than I/O-bound work.

**Why the numbers aren't round**: Real tests reflect JVM warmup state, OS scheduling, and GC timing. Some runs produced 97 successes instead of 100 (due to k6's `maxDuration` limit). Clean round numbers only exist in theory.

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

Three things this exercise produced:

1. **If you're putting numbers in a blog post, actually run them.** Estimates can point in the right direction but get the magnitude wrong. We predicted DB lock P95 at 12.5 seconds; actual was 1.2 seconds.

2. **Existing protection mechanisms in the test environment will bite you.** One Rate Limiter caused the token strategy to show 0% success. When adding new endpoints, revisit the existing filter and interceptor list.

3. **In async flows, define "success" explicitly in both server code and test scripts.** The queue's `COMPLETED` state needed to distinguish "purchase succeeded" from "request processed." When those definitions diverge, the measurement breaks.

Part 8's numbers have been replaced with measured data. Some predictions were far off. One ranking reversed. That's what real tests are for.

- Previous: [Part 8 — FCFS System Showdown: Load Testing All Approaches](/blog/en/fcfs-load-test-comparison)
- Next: [7 Practical Patterns for java.util.concurrent](/blog/en/java-concurrent-practical-patterns)

---

If you ever wondered whether the numbers in the blog were real — now they are.
