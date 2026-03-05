---
title: "Spring Boot Practical Guide Part 4: Resilience Patterns"
description: "Building fault-tolerant systems with Circuit Breaker, Rate Limiter, and Bulkhead"
pubDate: "2026-01-25T13:00:00+09:00"
lang: en
tags: ["Spring Boot", "Resilience4j", "Circuit Breaker", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| [Part 3: Event-Driven](/en/blog/springboot-practical-guide-3) | **Part 4: Resilience Patterns** | [Part 5: DB Optimization](/en/blog/springboot-practical-guide-5) |

---

## Introduction

In distributed systems, failures are inevitable. What matters is ensuring that **the entire system does not go down** when a failure occurs. In this part, we cover failure response patterns using Resilience4j.

**Topics covered in Part 4:**
- Preventing failure propagation with Circuit Breaker
- Blocking excessive requests with Rate Limiter
- Isolating resources with Bulkhead
- Handling transient failures with Retry
- Pattern combinations and Fallback strategies

### Table of Contents

- [Why Are Resilience Patterns Needed?](#1-why-are-resilience-patterns-needed)
- [Circuit Breaker Pattern](#2-circuit-breaker-pattern)
- [Rate Limiter](#3-rate-limiter)
- [Bulkhead Pattern](#4-bulkhead-pattern)
- [Retry Pattern](#5-retry-pattern)
- [Pattern Combinations](#6-pattern-combinations)
- [Fallback Strategies](#7-fallback-strategies)
- [Monitoring](#8-monitoring)
- [Configuration Tuning Guide](#9-configuration-tuning-guide)
- [FAQ](#10-faq-interview-prep)
- [Summary](#summary)

---

## 1. Why Are Resilience Patterns Needed?

### 1.1 The Reality of Distributed Systems

```
Microservice Environment:

[Client] ──▶ [API Gateway] ──▶ [OrderService]
                                     │
                   ┌─────────────────┼─────────────────┐
                   ▼                 ▼                 ▼
            [PaymentService]  [InventoryService]  [EmailService]
                   │                 │                 │
                   ▼                 ▼                 ▼
            [External PG]        [DB]           [SMTP Server]

→ What happens if any one of these slows down or dies?
```

**Failures are guaranteed to happen:**

| Failure Type | Example | Frequency |
|----------|------|----------|
| Network Latency | Timeouts, packet loss | Very common |
| Service Down | OOM, deployment failure | Common |
| Dependency Failure | DB connection pool exhaustion, external API down | Common |
| Resource Exhaustion | CPU 100%, disk full | Occasional |

### 1.2 Cascading Failure

```
1. EmailService becomes slow (5s response time)

2. OrderService waits when calling EmailService
   ┌─────────────────────────────────────────┐
   │ OrderService Thread Pool (20 threads)   │
   │                                         │
   │ [Wait] [Wait] [Wait] [Wait] [Wait]      │
   │ [Wait] [Wait] [Wait] [Wait] [Wait]      │
   │ [Wait] [Wait] [Wait] [Wait] [Wait]      │
   │ [Wait] [Wait] [Wait] [Wait] [Wait]      │
   │                                         │
   │ → All threads waiting for EmailService  │
   └─────────────────────────────────────────┘

3. Cannot process new order requests → OrderService goes down too

4. Other services depending on OrderService are also affected

→ A single slow service brings down the entire system
```

### 1.3 Goals of Resilience Patterns

| Goal | Description |
|------|------|
| **Fault Isolation** | A failure in one service does not propagate to others |
| **Fast Failure** | A quick error is better than a slow response |
| **Graceful Degradation** | Core functionality works even if some features are unavailable |
| **Automatic Recovery** | Automatically restores when the failed service recovers |

---

## 2. Circuit Breaker Pattern

### 2.1 Named After an Electrical Circuit Breaker

```
Real electrical circuit breaker:
Overcurrent detected → Breaker trips → Prevents fire

Software Circuit Breaker:
Failure detected → Calls blocked → System protected
```

### 2.2 Three States

```
                  Failure rate < threshold
              ┌───────────────────┐
              │                   │
              ▼                   │
         ┌─────────┐              │
         │ CLOSED  │──────────────┘
         │ (Normal) │
         └────┬────┘
              │ Failure rate >= threshold
              ▼
         ┌─────────┐
         │  OPEN   │ ← All requests fail immediately
         │(Blocked) │
         └────┬────┘
              │ Wait duration elapsed
              ▼
         ┌─────────┐
         │HALF-OPEN│ ← Only some requests allowed
         │ (Test)   │
         └────┬────┘
              │
      ┌───────┴───────┐
      │               │
  High success    Continued
     rate          failures
      │               │
      ▼               ▼
   CLOSED           OPEN
```

### 2.3 Project Configuration

```yaml
# application.yml
resilience4j:
  circuitbreaker:
    instances:
      orderService:
        sliding-window-size: 10           # Based on the last 10 requests
        failure-rate-threshold: 50        # OPEN when 50% or more fail
        wait-duration-in-open-state: 10s  # HALF-OPEN after 10 seconds
        permitted-number-of-calls-in-half-open-state: 3  # 3 test requests
        slow-call-duration-threshold: 2s  # Calls over 2s are considered slow
        slow-call-rate-threshold: 50      # OPEN when 50% or more are slow
        ignore-exceptions:
          - com.example.marketplace.common.BusinessException  # Ignore business exceptions
```

**Configuration explained:**

| Setting | Meaning |
|------|------|
| `sliding-window-size: 10` | Tracks success/failure of the last 10 requests |
| `failure-rate-threshold: 50` | Trips when 5 or more out of 10 fail |
| `wait-duration-in-open-state: 10s` | Tests after 10 seconds of being tripped |
| `slow-call-duration-threshold: 2s` | Calls exceeding 2s are considered "slow" |
| `ignore-exceptions` | BusinessException is not counted as a failure |

### 2.4 Code Implementation

```kotlin
// OrderService.kt
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // Normal logic
    return OrderResponse.from(savedOrder)
}

// Fallback called when circuit is open
private fun createOrderFallback(
    buyerId: Long,
    req: CreateOrderRequest,
    ex: Throwable
): OrderResponse {
    log.error("Circuit breaker fallback: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}
```

### 2.5 Behavior Scenario

```
Scenario: DB connection failure occurs

Time 0s:  Request 1 - Success
Time 1s:  Request 2 - Success
Time 2s:  Request 3 - Failure (DB timeout)
Time 3s:  Request 4 - Failure
Time 4s:  Request 5 - Failure
Time 5s:  Request 6 - Failure
Time 6s:  Request 7 - Failure
          → Failure rate 71% (5/7) > 50% → Transitions to OPEN state

Time 7s:  Request 8 - Immediate failure (no DB call)
Time 8s:  Request 9 - Immediate failure
          ...
Time 16s: Transitions to HALF-OPEN
          Request 10 - Success
          Request 11 - Success
          Request 12 - Success
          → All 3 successful → Recovers to CLOSED
```

---

## 3. Rate Limiter

### 3.1 Why Is It Needed?

```
Problem scenario:
┌─────────────────────────────────────────┐
│ Malicious user or buggy client          │
│                                         │
│ Generating 10,000 requests per second   │
│          │                              │
│          ▼                              │
│ ┌─────────────────┐                     │
│ │ Server overload  │ → Normal users     │
│ │ Response delay   │   affected too     │
│ │ Out of memory    │                    │
│ └─────────────────┘                     │
└─────────────────────────────────────────┘
```

### 3.2 Resilience4j RateLimiter Options

Resilience4j provides a RateLimiter based on the **token bucket** algorithm.

#### Core Configuration Options

| Option | Description | Default |
|------|------|--------|
| `limitForPeriod` | Number of requests allowed per period | 50 |
| `limitRefreshPeriod` | Period at which permissions (tokens) are refreshed | 500ns |
| `timeoutDuration` | Wait time for permission acquisition (0 means immediate rejection) | 5s |

#### Detailed Configuration

```yaml
resilience4j:
  ratelimiter:
    instances:
      orderCreation:
        limit-for-period: 10        # Allow 10 requests per period
        limit-refresh-period: 1s    # Refill tokens every 1 second
        timeout-duration: 0s        # Reject immediately without waiting
```

**How it works (token bucket):**

```
┌─────────────────────────────────────────────────────────────┐
│  Token Bucket (limit-for-period: 10)                          │
│                                                             │
│  [●] [●] [●] [●] [●] [●] [●] [●] [●] [●]  ← 10 tokens      │
│                                                             │
│  Request 1: Consume token → [●] [●] [●] [●] [●] [●] [●] [●] [●]    │
│  Request 2: Consume token → [●] [●] [●] [●] [●] [●] [●] [●]        │
│  ...                                                        │
│  Request 10: Consume token → [ ] (empty bucket)             │
│  Request 11: No token → reject or wait                      │
│                                                             │
│  After 1 second (limit-refresh-period):                     │
│  Token refill → [●] [●] [●] [●] [●] [●] [●] [●] [●] [●]    │
└─────────────────────────────────────────────────────────────┘
```

#### timeoutDuration Behavior

```
timeout-duration: 0s (immediate rejection)
─────────────────────────────────
Request 11 arrives → No token → Immediate RequestNotPermitted exception

timeout-duration: 5s (wait up to 5 seconds)
─────────────────────────────────
Request 11 arrives → No token → Wait up to 5 seconds
  └── If token refilled within 5s → Request processed
  └── If still no token after 5s → RequestNotPermitted exception
```

#### Per-User Rate Limiting (Advanced)

```kotlin
// Apply different RateLimiter per IP or user ID
fun getRateLimiterForUser(userId: String): RateLimiter {
    return rateLimiterRegistry.rateLimiter(
        "user-$userId",
        RateLimiterConfig.custom()
            .limitForPeriod(10)
            .limitRefreshPeriod(Duration.ofSeconds(1))
            .timeoutDuration(Duration.ZERO)
            .build()
    )
}
```

#### Event Listener

```kotlin
// Monitor RateLimiter events
val rateLimiter = rateLimiterRegistry.rateLimiter("orderCreation")

rateLimiter.eventPublisher
    .onSuccess { event ->
        log.debug("Rate limit passed: ${event.rateLimiterName}")
    }
    .onFailure { event ->
        log.warn("Rate limit exceeded: ${event.rateLimiterName}")
    }
```

#### Metrics

```
# Prometheus metrics
resilience4j_ratelimiter_available_permissions{name="orderCreation"} 8
resilience4j_ratelimiter_waiting_threads{name="orderCreation"} 0
resilience4j_ratelimiter_calls_total{name="orderCreation", kind="successful"} 100
resilience4j_ratelimiter_calls_total{name="orderCreation", kind="failed"} 5
```

### 3.3 Project Configuration

```yaml
# application.yml
resilience4j:
  ratelimiter:
    instances:
      default:
        limit-for-period: 100       # Allow 100 per second
        limit-refresh-period: 1s    # Reset every second
        timeout-duration: 0s        # Reject immediately without waiting
      orderCreation:
        limit-for-period: 10        # Only 10 order creations per second
        limit-refresh-period: 1s
        timeout-duration: 0s
```

### 3.4 Using Resilience4j in a Spring Filter

```kotlin
// RateLimitingFilter.kt
@Component
class RateLimitingFilter(
    private val rateLimiterRegistry: RateLimiterRegistry
) : OncePerRequestFilter() {

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        // Apply different Rate Limiter based on request path
        val rateLimiterName = determineRateLimiter(request)
        val rateLimiter = rateLimiterRegistry.rateLimiter(rateLimiterName)

        if (rateLimiter.acquirePermission()) {
            filterChain.doFilter(request, response)  // Allowed
        } else {
            handleRateLimitExceeded(response)        // 429 response
        }
    }

    private fun determineRateLimiter(request: HttpServletRequest): String {
        return when {
            // Stricter limit for order creation API
            request.requestURI.startsWith("/api/v1/orders")
                && request.method == "POST" -> "orderCreation"
            else -> "default"
        }
    }
}
```

### 3.5 Response Example

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json

{
    "success": false,
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
}
```

### 3.6 Rate Limiting Algorithm Details

#### 1) Fixed Window

```
Counting by dividing time into fixed intervals

limit: 10 per second

00:00:00 ~ 00:00:01 (Window 1)
├── Requests 1~10: ✅ Allowed
└── Request 11: ❌ Rejected

00:00:01 ~ 00:00:02 (Window 2)
├── Counter reset
└── Requests 1~10: ✅ Allowed

Problem: Burst at window boundary
────────────────────────────────────
10 requests at 00:00:00.9 ✅
10 requests at 00:00:01.1 ✅
→ 20 requests pass in 0.2 seconds (2x the intended limit!)
```

**Pros**: Simple implementation, memory efficient
**Cons**: Allows bursts at window boundaries

---

#### 2) Sliding Window

```
Calculates based on the last N seconds from the current time

limit: 10 per second

Current time: 00:00:01.5
Sliding window: 00:00:00.5 ~ 00:00:01.5

┌─────────────────────────────────────────────────┐
│ Timeline                                         │
│ 0.0   0.5   1.0   1.5   2.0                     │
│  │     │     │     │     │                      │
│  ├─────┴─────┤     │                            │
│  │ Prev window │     │                            │
│        ├─────┴─────┤                            │
│        │Sliding window│ ← Current reference       │
└─────────────────────────────────────────────────┘

Calculation:
- Previous window requests: 8
- Current window requests: 4 (occurred between 1.0~1.5)
- Previous window weight: 50% (0.5s/1s)
- Estimated requests: 8 * 0.5 + 4 = 8
- Less than 10 → ✅ Allowed
```

**Pros**: Solves boundary burst problem
**Cons**: Complex calculation, slightly more memory

---

#### 3) Token Bucket - Used by Resilience4j

```
Tokens are added to the bucket at a steady rate; requests consume tokens

Config: limit-for-period: 10, limit-refresh-period: 1s

┌─────────────────────────────────────────────────┐
│  Token Bucket                                    │
│  ┌─────────────────────────────────┐            │
│  │ [●][●][●][●][●][●][●][●][●][●] │ ← 10       │
│  └─────────────────────────────────┘            │
│         ↑                                       │
│    Refill 10 tokens every 1 second              │
│    (only refills empty slots)                   │
└─────────────────────────────────────────────────┘

Scenario:
T=0.0s: Bucket [●●●●●●●●●●] (10 tokens)
T=0.1s: 5 requests → [●●●●●] (5 remaining)
T=0.2s: 3 requests → [●●] (2 remaining)
T=0.3s: 5 requests → Only 2 processed, 3 rejected or wait
T=1.0s: Refill → [●●●●●●●●●●] (10 tokens)

Burst allowance:
────────────────────────────────────
If no requests for a while, tokens accumulate
→ Can handle many requests at once (burst)
→ On average, the limit is maintained
```

**Pros**: Allows bursts, smooth limiting
**Cons**: Possible sudden traffic spikes

---

#### 4) Leaky Bucket

```
Requests accumulate in the bucket and "leak out" at a constant rate

Processing rate: 10 per second (1 every 100ms)

┌─────────────────────────────────────────────────┐
│  Request arrival                                 │
│      ↓ ↓ ↓ ↓ ↓                                  │
│  ┌─────────────────────────────────┐            │
│  │  [ ][ ][ ][●][●][●][●][●]      │ ← Queue    │
│  └─────────────────────────────────┘            │
│                              ↓                  │
│                       Processed at              │
│                       constant rate             │
│                       (leaks out)               │
│                              ↓                  │
│                         [Processed]             │
└─────────────────────────────────────────────────┘

Characteristics:
- Processing rate stays constant no matter how many requests arrive
- New requests rejected when bucket (queue) is full
- "Smooths out" traffic
```

**Pros**: Uniform processing rate, protects backend
**Cons**: No bursts allowed, introduces latency

---

#### Algorithm Comparison Summary

| Algorithm | Burst | Accuracy | Implementation Complexity | Use Case |
|----------|--------|--------|------------|--------|
| Fixed Window | 2x at boundaries | Low | Very simple | Simple API limiting |
| Sliding Window | None | High | Medium | When precise limiting is needed |
| **Token Bucket** | Allowed | Medium | Medium | **Resilience4j, most cases** |
| Leaky Bucket | None | High | Medium | When uniform processing is needed |

#### Why Resilience4j Uses Token Bucket

```
1. Burst Allowance
   - Real traffic is uneven
   - Handles momentary request spikes naturally

2. Implementation Efficiency
   - Only manages token count with AtomicInteger
   - No need to store request history

3. Intuitive Configuration
   - "10 per second" = limit-for-period: 10, limit-refresh-period: 1s
   - Easy to understand
```

---

## 4. Bulkhead Pattern

### 4.1 Named After Ship Bulkheads

```
Ship structure:
┌─────┬─────┬─────┬─────┐
│     │     │     │     │
│Comp1│Comp2│Comp3│Comp4│
│     │     │     │     │
└─────┴─────┴─────┴─────┘
    │
    └── Even if one compartment floods, others remain safe

Software Bulkhead:
┌─────────────────────────────────────────┐
│           Thread Pool Isolation          │
│                                         │
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│ │  Order   │  │ Product  │  │ Payment  │  │
│ │Processing│  │  Query   │  │Processing│  │
│ │20 threads│  │30 threads│  │10 threads│  │
│ └─────────┘  └─────────┘  └─────────┘  │
│      │                                  │
│      └── Even if order processing slows │
│          down, product queries are      │
│          unaffected                     │
└─────────────────────────────────────────┘
```

### 4.2 Project Configuration

```yaml
# application.yml
resilience4j:
  bulkhead:
    instances:
      orderService:
        max-concurrent-calls: 20     # Max 20 concurrent calls
        max-wait-duration: 0s        # Reject immediately without waiting
```

### 4.3 Code Implementation

```kotlin
// OrderService.kt
@Bulkhead(name = "orderService")  // Up to 20 concurrent calls
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // ...
}
```

### 4.4 Behavior Scenario

```
Config: max-concurrent-calls = 20

Current state:
┌─────────────────────────────────────────┐
│ OrderService Bulkhead                   │
│                                         │
│ Processing: [1] [2] [3] ... [18] [19] [20] │
│                                         │
│ Slots: 20/20 in use                     │
└─────────────────────────────────────────┘

New request #21 arrives:
→ max-wait-duration: 0s so immediately rejected
→ BulkheadFullException thrown
→ Fallback invoked or 503 Service Unavailable
```

---

## 5. Retry Pattern

### 5.1 Handling Transient Failures

```
Temporary network disconnection:
Request 1: ❌ Failure (momentary network outage)
Request 2: ✅ Success (recovered after 0.5s)

→ Retrying can lead to success
```

### 5.2 Project Configuration

```yaml
# application.yml
resilience4j:
  retry:
    instances:
      orderService:
        max-attempts: 3              # Max 3 attempts
        wait-duration: 500ms         # 500ms between retries
        retry-exceptions:
          - java.io.IOException          # Only retry on network errors
          - java.util.concurrent.TimeoutException
```

### 5.3 Code Implementation

```kotlin
// OrderService.kt
@Retry(name = "orderService")
@Bulkhead(name = "orderService")
@CircuitBreaker(name = "orderService", fallbackMethod = "createOrderFallback")
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // Automatically retries on IOException
}
```

### 5.4 Caution: Idempotency

```
Problem scenario:
┌─────────────────────────────────────────┐
│ 1st attempt: Create order request       │
│              Saved to DB                │
│              Network drops during       │
│              response return            │
│                                         │
│ 2nd attempt: Same request retried       │
│              Saved to DB again →        │
│              Duplicate order!!          │
└─────────────────────────────────────────┘

Solution: Use an Idempotency Key
POST /api/v1/orders
Idempotency-Key: abc-123-def

→ When requesting with the same key, returns previous result (no new creation)
```

### 5.5 Retry vs Circuit Breaker

| Situation | Retry | Circuit Breaker |
|------|-------|-----------------|
| Transient failure | Can succeed with retry | - |
| Persistent failure | Keeps failing, wastes resources | Fails fast, protects system |
| Combined | Retry first → Failures accumulate → Circuit Breaker trips |

---

## 6. Pattern Combinations

### 6.1 Application Order

```kotlin
// OrderService.kt
@Retry(name = "orderService")                                    // 3. Retry
@Bulkhead(name = "orderService")                                 // 2. Concurrency limit
@CircuitBreaker(name = "orderService", fallbackMethod = "...")   // 1. Circuit breaker
fun createOrder(buyerId: Long, req: CreateOrderRequest): OrderResponse {
    // Execute
}

Execution order (from outermost):
[CircuitBreaker] → [Bulkhead] → [Retry] → [Actual Logic]

Request processing flow:
1. CircuitBreaker: If OPEN, immediately call fallback
2. Bulkhead: If no slot available, reject
3. Retry: Retry on failure
4. Execute actual logic
```

### 6.2 Complete Flow

```
Request arrives
    │
    ▼
┌─────────────────┐
│ RateLimiter     │ → 429 response if exceeded
│ (HTTP Filter)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ CircuitBreaker  │ → Immediate fallback if OPEN
│                 │
└────────┬────────┘
         │ CLOSED
         ▼
┌─────────────────┐
│ Bulkhead        │ → Reject if no slots
│                 │
└────────┬────────┘
         │ Slot acquired
         ▼
┌─────────────────┐
│ Retry           │ → Retry on failure (max 3 times)
│                 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Business Logic  │
│                 │
└─────────────────┘
```

---

## 7. Fallback Strategies

### 7.1 Fallback Types

```kotlin
// 1. Return default value
private fun getProductsFallback(ex: Throwable): List<ProductResponse> {
    return emptyList()  // Return empty list
}

// 2. Return cached data
private fun getProductsFallback(ex: Throwable): List<ProductResponse> {
    return cachedProducts ?: emptyList()
}

// 3. Error response
private fun createOrderFallback(ex: Throwable): OrderResponse {
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}

// 4. Call alternative service
private fun getRecommendationsFallback(ex: Throwable): List<Product> {
    return fallbackRecommendationService.getPopularProducts()
}
```

### 7.2 Project Fallbacks

```kotlin
// OrderService.kt - When order creation fails
private fun createOrderFallback(
    buyerId: Long,
    req: CreateOrderRequest,
    ex: Throwable
): OrderResponse {
    log.error("Circuit breaker fallback triggered for createOrder. " +
              "Buyer: $buyerId, Error: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}

// ProductService.kt - When product search fails
private fun searchProductsFallback(
    req: ProductSearchRequest,
    pageable: Pageable,
    ex: Throwable
): Page<ProductResponse> {
    log.error("Circuit breaker fallback triggered for searchProducts. " +
              "Error: ${ex.message}")
    throw BusinessException(ErrorCode.SERVICE_UNAVAILABLE)
}
```

### 7.3 Fallback Selection Criteria

| Feature Type | Fallback Strategy | Example |
|----------|--------------|------|
| **Core Feature** | Propagate error | Payment failure → Return error |
| **Supplementary Feature** | Default value/cache | Recommendation failure → Popular products |
| **Query Feature** | Cached data | Product query failure → Return cache |

---

## 8. Monitoring

### 8.1 Actuator Endpoints

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health, info, metrics, circuitbreakers, ratelimiters
  endpoint:
    health:
      show-details: when_authorized
```

### 8.2 Circuit Breaker Status Check

```bash
# Query Circuit Breaker status
curl http://localhost:8080/actuator/circuitbreakers

{
  "circuitBreakers": {
    "orderService": {
      "state": "CLOSED",
      "failureRate": "0.0%",
      "slowCallRate": "0.0%",
      "numberOfFailedCalls": 0,
      "numberOfSlowCalls": 0
    }
  }
}
```

### 8.3 Metrics

```
resilience4j.circuitbreaker.state{name="orderService"} 0  # 0=CLOSED, 1=OPEN, 2=HALF_OPEN
resilience4j.circuitbreaker.failure.rate{name="orderService"} 0.0
resilience4j.ratelimiter.available.permissions{name="default"} 100
resilience4j.bulkhead.available.concurrent.calls{name="orderService"} 20
```

---

## 9. Configuration Tuning Guide

### 9.1 Circuit Breaker Tuning

```yaml
# Conservative settings (sensitive to failures)
sliding-window-size: 5
failure-rate-threshold: 30
wait-duration-in-open-state: 30s

# Lenient settings (tolerates transient failures)
sliding-window-size: 20
failure-rate-threshold: 70
wait-duration-in-open-state: 5s
```

### 9.2 Rate Limiter Tuning

```yaml
# Strict limiting (DDoS defense)
limit-for-period: 10
limit-refresh-period: 1s

# Loose limiting (general use)
limit-for-period: 1000
limit-refresh-period: 1s
```

### 9.3 Environment-Specific Settings

| Environment | Rate Limit | Circuit Breaker | Bulkhead |
|------|-----------|-----------------|----------|
| Development | High | Lenient | High |
| Staging | Same as production | Same | Same |
| Production | Appropriate | Appropriate | Appropriate |

---

## 10. FAQ (Interview Prep)

### Q1. Why use the Circuit Breaker pattern?

If you keep sending requests to a failing service:
- Threads wait and waste resources
- Timeout accumulation causes response delays
- Eventually the caller also fails

Circuit Breaker blocks requests when the failure rate exceeds a threshold:
- Fast Fail
- Fault isolation
- Gives the failing service time to recover

### Q2. Explain the 3 states of a Circuit Breaker.

| State | Description |
|------|------|
| **CLOSED** | Normal state. All requests pass through |
| **OPEN** | Blocked state. All requests fail immediately |
| **HALF-OPEN** | Test state. Only some requests pass through to check recovery |

### Q3. What is the difference between Rate Limiting and Bulkhead?

| Aspect | Rate Limiting | Bulkhead |
|------|--------------|----------|
| What it limits | Requests per time period | Concurrent executions |
| Purpose | Prevent excessive traffic | Resource isolation |
| Example | 100 per second | 20 concurrent |
| Where applied | Mainly API Gateway, filters | Service methods |

### Q4. What should you be careful about when using the Retry pattern?

1. **Ensure idempotency**: Retrying must produce the same result
2. **Select retry targets**: Only retry transient failures (IOException, etc.)
3. **Exponential backoff**: Gradually increase retry intervals (500ms → 1s → 2s)
4. **Limit max attempts**: Prevent infinite retries

### Q5. What happens when Circuit Breaker and Retry are used together?

```
Retry executes first, and when failures accumulate, Circuit Breaker trips:

Request → Retry(3 times) → All fail → Circuit Breaker failure count +1
Request → Retry(3 times) → All fail → Circuit Breaker failure count +2
...
Failure rate exceeds 50% → Circuit Breaker OPEN
→ Subsequent requests fail immediately without Retry
```

### Q6. What are the different Fallback strategies?

| Strategy | Description | Use Case |
|------|------|----------|
| Return default value | Empty list, default object | List queries |
| Return cache | Previously cached data | Infrequently changing data |
| Error response | 503 Service Unavailable | Core features |
| Alternative service | Call backup service | High availability required |

---

## 11. Project File Structure

```
marketplace-api/
├── src/main/kotlin/.../
│   ├── config/
│   │   └── RateLimitingFilter.kt     # HTTP Rate Limiting
│   │
│   ├── order/
│   │   └── OrderService.kt           # @CircuitBreaker, @Bulkhead, @Retry
│   │
│   ├── product/
│   │   └── ProductService.kt         # @CircuitBreaker
│   │
│   └── common/
│       └── ErrorCode.kt              # RATE_LIMITED, SERVICE_UNAVAILABLE
│
└── src/main/resources/
    └── application.yml               # Resilience4j configuration
```

---

## Summary

### Pattern Comparison

| Pattern | Purpose | When to Use |
|------|------|----------|
| **Circuit Breaker** | Block calls to failing services | External API, dependent service calls |
| **Rate Limiter** | Block excessive requests | API endpoint protection |
| **Bulkhead** | Isolate resources | Protect critical services |
| **Retry** | Recover from transient failures | Network errors, timeouts |

### Circuit Breaker States

| State | Description |
|------|------|
| **CLOSED** | Normal state. All requests pass through |
| **OPEN** | Blocked state. All requests fail immediately |
| **HALF-OPEN** | Test state. Only some requests pass through to check recovery |

### Quick Checklist

- [ ] Is Circuit Breaker applied to external API calls?
- [ ] Is Rate Limiter configured for public APIs?
- [ ] Are critical services isolated with Bulkhead?
- [ ] Is Retry only applied to idempotent operations?
- [ ] Are Fallback strategies properly configured?
- [ ] Can you monitor Circuit Breaker state?
- [ ] Is BusinessException excluded from Circuit Breaker?

---

The next part covers **Database Optimization (indexes, pagination)**.

👉 [Next: Part 5 - Database Optimization](/en/blog/springboot-practical-guide-5)
