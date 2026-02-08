---
title: "Spring Boot Practical Guide Part 1: Concurrency Control and Inventory Management"
description: "A practical guide to solving concurrency issues with atomic UPDATEs and idempotency keys"
pubDate: 2026-02-08T11:00:00+09:00
lang: en
tags: ["Spring Boot", "Concurrency", "Backend", "Practical Guide"]
heroImage: "../../../assets/PracticalGuideSeries.png"
---

## Series Navigation

| Previous | Current | Next |
|:---:|:---:|:---:|
| - | **Part 1: Concurrency Control** | [Part 2: Caching Strategy](/en/blog/springboot-practical-guide-2) |

---

## Introduction

This series is a guide that covers common problems and solution patterns encountered in real-world Spring Boot projects.

**Topics covered in Part 1:**
- Why concurrency issues occur (Check-Then-Act pattern)
- Solving inventory/coupon problems with atomic UPDATEs
- Preventing duplicate orders with idempotency keys
- When distributed locks are truly needed

### Table of Contents

- [Problem Definition: Why Is Concurrency Control Needed?](#1-problem-definition-why-is-concurrency-control-needed)
- [Solution 1: Atomic Inventory Updates](#2-solution-1-atomic-inventory-updates)
- [Solution 2: Idempotency Keys](#3-solution-2-idempotency-keys)
- [When Distributed Locks Are Needed](#4-when-distributed-locks-are-needed)
- [Distributed Locks Deep Dive](#5-distributed-locks-deep-dive)
- [Hands-On and Testing](#6-hands-on-and-testing)
- [FAQ](#7-faq-frequently-asked-questions)
- [Summary](#summary)

---

## 1. Problem Definition: Why Is Concurrency Control Needed?

### 1.1 Problem 1: Inventory Overselling

A scenario where 2 users simultaneously order a product with only 1 item left in stock:

```
Time    User A                User B                Stock (DB)
─────────────────────────────────────────────────────────────
T1      Check stock → 1        -                    1
T2      -                    Check stock → 1        1
T3      1 >= 1 → Can order!   -                    1
T4      -                    1 >= 1 → Can order!   1
T5      Decrease stock (1→0)   -                    0
T6      -                    Decrease stock (0→-1)  -1 ❌
```

**Result**: Stock is 1 but 2 items sold → **Overselling** occurs!

**Root Cause**: Vulnerability of the Check-Then-Act pattern

```kotlin
// ❌ Dangerous code
fun createOrder(productId: Long, quantity: Int) {
    val product = productRepository.findById(productId)
    if (product.stockQuantity >= quantity) {       // Check
        product.stockQuantity -= quantity          // Act (other threads can interleave here!)
        productRepository.save(product)
    }
}
```

### 1.2 Problem 2: Duplicate Orders / Duplicate Coupon Usage

A scenario where the same user rapidly clicks the order button or tries to use a coupon more than once:

```
Time    User A (Request 1)        User A (Request 2)        Issue
─────────────────────────────────────────────────────────────────
T1      Check coupon → exists      -
T2      -                        Check coupon → exists
T3      Mark coupon as used        -
T4      -                        Mark coupon as used        ⚠️ Duplicate use?
T5      Create order #1           -
T6      -                        Create order #2           ⚠️ Duplicate order?
```

### 1.3 Summary of Problems and Solutions

| Problem | Cause | Recommended Solution | Note |
|---------|-------|---------------------|------|
| **Inventory Overselling** | Check-Then-Act | **Atomic UPDATE** | Essential |
| **Duplicate Coupon Usage** | Check-Then-Act | **Atomic UPDATE** | Essential |
| **Duplicate Orders (rapid clicks)** | Button spamming | **Idempotency Key** | Recommended |
| **Cache Stampede** | Cache expiry | **Distributed Lock** | Optional |
| **Duplicate Batch Execution** | Multiple instances | **Distributed Lock** | Optional |

---

## 2. Solution 1: Atomic Inventory Updates

### 2.1 What Is an Atomic Operation?

An operation that completes **all at once** without being interrupted. No other transaction can interleave.

```
┌─────────────────────────────────────────────────────────────┐
│  Normal Approach (3 steps)         Atomic Approach (1 step)  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. SELECT stock     ← Can be interleaved                   │
│  2. App calculates   ← Can be interleaved     vs  1. UPDATE │
│  3. UPDATE stock     ← Can be interleaved         WHERE cond│
│                                                             │
│  ❌ Race Condition occurs           ✅ DB guarantees atomicity│
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Comparison: Traditional vs Atomic Approach

```kotlin
// ❌ Traditional approach (3 queries, can be interleaved)
val product = repository.findById(id)        // SELECT
if (product.stockQuantity >= quantity) {
    product.stockQuantity -= quantity
    repository.save(product)                  // UPDATE
}

// ✅ Atomic approach (1 query for condition check + update)
val updated = repository.decreaseStockAtomically(id, quantity)
if (updated == 0) throw BusinessException(ErrorCode.INSUFFICIENT_STOCK)
```

### 2.3 Atomic Stock Decrease Query

```kotlin
@Modifying
@Query("""
    UPDATE Product p
    SET p.stockQuantity = p.stockQuantity - :quantity,
        p.salesCount = p.salesCount + :quantity
    WHERE p.id = :productId
    AND p.stockQuantity >= :quantity   -- ⭐ Key point: conditional update
    AND p.status = 'ON_SALE'
""")
fun decreaseStockAtomically(productId: Long, quantity: Int): Int
```

### 2.4 Behavior Under Concurrent Requests

```
Time    User A                             User B
────────────────────────────────────────────────────────────
        Stock: 1 item

T1      UPDATE WHERE stock >= 1           UPDATE WHERE stock >= 1
        ↓                                 ↓
        Acquires DB Row Lock              Waiting for DB Row Lock...

T2      Changes stock to 0                (Waiting)
        COMMIT

T3      updateCount = 1 ✅                 Acquires DB Row Lock
                                          stock(0) >= 1? → FALSE

T4                                        updateCount = 0 ❌
                                          → INSUFFICIENT_STOCK
```

**Result**: Exactly 1 item sold!

### 2.5 Why Does This Work? (DB Row Lock)

```
┌─────────────────────────────────────────────────────────────┐
│  InnoDB (MySQL) / PostgreSQL Row-Level Lock                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  When an UPDATE statement executes:                          │
│  1. Acquires an Exclusive Lock (X-Lock) on the target row   │
│  2. Other transactions cannot modify the same row (they wait)│
│  3. Lock released after COMMIT → next transaction proceeds  │
│                                                             │
│  ※ The WHERE condition is re-evaluated after lock acquisition│
│  → If stock is already 0, condition fails → updateCount = 0 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

> **Key Insight**: The DB's own Row Lock mechanism handles concurrency. This is why inventory protection is possible without a separate distributed lock.

---

## 3. Solution 2: Idempotency Keys

### 3.1 What Is an Idempotency Key?

A unique key that ensures the same request is processed only once, even if sent multiple times.

```kotlin
@PostMapping("/orders")
fun createOrder(
    @RequestHeader("Idempotency-Key") idempotencyKey: String,
    @RequestBody request: OrderCreateRequest
): OrderResponse {
    // 1. Check if request was already processed
    val cached = redisTemplate.opsForValue().get("idempotency:$idempotencyKey")
    if (cached != null) return cached  // Return previous result

    // 2. Process new order
    val result = orderService.createOrder(request)

    // 3. Cache the result (24 hours)
    redisTemplate.opsForValue().set("idempotency:$idempotencyKey", result, 24, TimeUnit.HOURS)
    return result
}
```

**Client side:**
```javascript
const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: {
        'Idempotency-Key': crypto.randomUUID(),  // Unique key per request
        'Content-Type': 'application/json'
    },
    body: JSON.stringify(orderData)
});
```

### 3.2 Improved Implementation (In-Progress State Management)

```kotlin
fun createOrder(idempotencyKey: String, request: OrderCreateRequest): OrderResponse {
    val cacheKey = "idempotency:$idempotencyKey"

    // 1. Check if request was already completed
    val cached = redisTemplate.opsForValue().get(cacheKey)
    if (cached is OrderResponse) return cached

    // 2. Check if currently processing (atomic check with SETNX)
    val acquired = redisTemplate.opsForValue()
        .setIfAbsent("$cacheKey:processing", "1", Duration.ofSeconds(30))
    if (acquired != true) {
        throw BusinessException(ErrorCode.REQUEST_IN_PROGRESS)
    }

    try {
        // 3. Process order
        val result = orderService.createOrder(request)

        // 4. Cache result
        redisTemplate.opsForValue().set(cacheKey, result, Duration.ofHours(24))
        return result
    } finally {
        redisTemplate.delete("$cacheKey:processing")
    }
}
```

### 3.3 Idempotency Key vs Distributed Lock

| Aspect | Idempotency Key | Distributed Lock |
|--------|----------------|-----------------|
| **Purpose** | Prevent duplicate requests | Serialize concurrent executions |
| **Mechanism** | Result caching | Lock acquire/release |
| **Complexity** | Low | Medium |
| **Best For** | Preventing duplicate orders | Cache stampede, batch jobs |

---

## 4. When Distributed Locks Are Needed

### 4.1 When Do You Actually Need a Distributed Lock?

In most order scenarios, distributed locks are **over-engineering**.

| Problem | Need Distributed Lock? | Better Alternative |
|---------|:---------------------:|-------------------|
| Inventory Overselling | ❌ | Atomic UPDATE |
| Duplicate Coupon Usage | ❌ | Atomic UPDATE |
| Duplicate Orders (rapid clicks) | ❌ | Idempotency Key |
| **Cache Stampede** | ✅ | - |
| **Duplicate Batch Execution** | ✅ | - |
| **External API Serialization** | ✅ | - |

### 4.2 Preventing Cache Stampede

```kotlin
fun getProduct(productId: Long): Product {
    val cached = redisTemplate.opsForValue().get("product:$productId")
    if (cached != null) return cached

    // On cache miss, 1000 requests hit DB simultaneously → DB dies
    val lock = redissonClient.getLock("cache:product:$productId")

    return if (lock.tryLock(1, 5, TimeUnit.SECONDS)) {
        try {
            // Double-check
            val recheck = redisTemplate.opsForValue().get("product:$productId")
            if (recheck != null) return recheck

            // Only 1 request queries DB
            val product = productRepository.findById(productId)
            redisTemplate.opsForValue().set("product:$productId", product, 1, TimeUnit.HOURS)
            product
        } finally {
            lock.unlock()
        }
    } else {
        Thread.sleep(100)
        redisTemplate.opsForValue().get("product:$productId")!!
    }
}
```

### 4.3 Preventing Duplicate Batch Execution

```kotlin
@Scheduled(cron = "0 0 0 * * *")
fun dailySettlement() {
    val lock = redissonClient.getLock("batch:daily-settlement")

    if (lock.tryLock(0, 30, TimeUnit.MINUTES)) {
        try {
            settlementService.process()  // Takes 30 minutes
        } finally {
            lock.unlock()
        }
    }
    // If lock not acquired, another instance is running → skip
}
```

### 4.4 External API Serialization Constraints

```kotlin
// Payment gateway returns error on simultaneous payment requests for the same user
@DistributedLock(key = "'payment:' + #userId")
fun processPayment(userId: Long, amount: Long) {
    paymentGateway.charge(userId, amount)  // External API
}
```

---

## 5. Distributed Locks Deep Dive

### 5.1 How Distributed Locks Work in Redis

#### Redisson's Lua Script (Lock Acquisition)

```lua
-- If lock doesn't exist, create a new one
if redis.call('exists', KEYS[1]) == 0 then
    redis.call('hset', KEYS[1], ARGV[2], 1)      -- Store owner ID
    redis.call('pexpire', KEYS[1], ARGV[1])      -- Set TTL
    return nil  -- Lock acquired successfully
end

-- If same thread already holds the lock (reentrant)
if redis.call('hexists', KEYS[1], ARGV[2]) == 1 then
    redis.call('hincrby', KEYS[1], ARGV[2], 1)   -- Increment counter
    redis.call('pexpire', KEYS[1], ARGV[1])
    return nil  -- Lock acquired successfully
end

return redis.call('pttl', KEYS[1])  -- Return remaining TTL (lock acquisition failed)
```

#### Watch Dog Auto-Renewal

```
┌─────────────────────────────────────────────────────────┐
│  Redisson Watch Dog (Background Thread)                  │
│                                                         │
│  Activates automatically when leaseTime is not specified │
│  (default 30 seconds)                                   │
│  Renews TTL every leaseTime/3 (10 seconds) while lock   │
│  is held                                                │
│                                                         │
│  [Business logic 10s elapsed] → Renew TTL to 30s        │
│  [Business logic 20s elapsed] → Renew TTL to 30s        │
│  [Business logic complete] → Release lock               │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Lock Strategy Selection Guide

| Aspect | Optimistic Lock | Pessimistic Lock | Distributed Lock |
|--------|----------------|-----------------|-----------------|
| **Mechanism** | Version check, fail on conflict | SELECT FOR UPDATE | Redis/ZooKeeper |
| **Conflict Handling** | Application retry | DB queue management | External system management |
| **Implementation** | `@Version` | `@Lock(PESSIMISTIC)` | Redisson, etc. |

#### Decision Flow

```
                        Start
                          │
                          ▼
                  ┌───────────────┐
                  │ Are conflicts  │
                  │ frequent?      │
                  └───────────────┘
                     │         │
                    No        Yes
                     │         │
                     ▼         ▼
              ┌──────────┐  ┌───────────────┐
              │ Use       │  │ Is lock hold  │
              │ Optimistic│  │ time long?    │
              │ Lock      │  │ (>100ms)      │
              └──────────┘  └───────────────┘
                               │         │
                              No        Yes
                               │         │
                               ▼         ▼
                        ┌──────────┐  ┌──────────┐
                        │ Use       │  │ Use       │
                        │Pessimistic│  │Distributed│
                        │ Lock      │  │ Lock      │
                        └──────────┘  └──────────┘
```

### 5.3 Practical Recommendations

| Service | Recommended Approach | Reason |
|---------|---------------------|--------|
| Post editing | Optimistic Lock | Concurrent edits are rare |
| Like count | None / Atomic UPDATE | Performance over precision |
| **Inventory deduction** | **Atomic UPDATE** | Solved at DB level |
| **Duplicate order prevention** | **Idempotency Key** | Lightweight and effective |
| **Cache refresh** | **Distributed Lock** | Prevents stampede |
| **Batch jobs** | **Distributed Lock** | Multi-instance environment |

---

## 6. Hands-On and Testing

### 6.1 k6 Concurrency Test

```javascript
// k6/concurrency-test.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
    vus: 10,
    duration: '5s',
};

export function setup() {
    let loginRes = http.post('http://localhost:8080/api/v1/auth/login',
        JSON.stringify({
            email: 'buyer@example.com',
            password: 'buyer123!'
        }),
        { headers: { 'Content-Type': 'application/json' } }
    );
    return { token: JSON.parse(loginRes.body).data.accessToken };
}

export default function(data) {
    let orderRes = http.post('http://localhost:8080/api/v1/orders',
        JSON.stringify({
            orderItems: [{ productId: 2, quantity: 1 }],
            shippingAddress: {
                zipCode: '12345', address: 'Test', addressDetail: 'Apt',
                receiverName: 'Test', receiverPhone: '010-1234-5678'
            }
        }),
        { headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.token}`
        }}
    );

    check(orderRes, {
        'status is 200 or 409': (r) => r.status === 200 || r.status === 409
    });
}
```

Run: `k6 run k6/concurrency-test.js`

### 6.2 Verifying Redis Locks

```bash
docker exec -it marketplace-redis redis-cli
> KEYS order:*
> HGETALL "order:create:1"
> TTL "order:create:1"
```

---

## 7. FAQ (Frequently Asked Questions)

### Q1. Can inventory really be protected without a distributed lock?

**A**: Yes, an atomic UPDATE alone is sufficient.

```sql
UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock >= 1
```

The DB's Row Lock handles concurrency.

### Q2. What happens when an atomic UPDATE fails?

**A**: `affected rows = 0` is returned, and the application throws an exception.

```kotlin
val updated = productRepository.decreaseStockAtomically(productId, quantity)
if (updated == 0) throw BusinessException(ErrorCode.INSUFFICIENT_STOCK)
```

### Q3. Can deadlocks occur when ordering multiple products simultaneously?

**A**: You can prevent deadlocks by sorting UPDATEs by product ID.

```kotlin
val items = orderItems.sortedBy { it.productId }
items.forEach { productRepository.decreaseStockAtomically(it.productId, it.quantity) }
```

### Q4. Who generates the idempotency key?

**A**: Typically the **client** generates it. A key is created when the button is clicked, and the same key is reused for retries.

### Q5. When should I use a distributed lock?

**A**: Use it only in the following cases:

| Use | Don't Use |
|-----|-----------|
| Cache stampede prevention | Inventory deduction |
| Batch job deduplication | Coupon usage |
| External API serialization | Duplicate order prevention |

**Decision criterion**: "Can this be solved with an atomic UPDATE or idempotency key?" → If yes, no distributed lock needed.

---

## Summary

### Key Takeaways

| Problem | Solution | Description |
|---------|----------|-------------|
| **Inventory Overselling** | **Atomic Update** | Conditional decrease with `UPDATE WHERE stock >= qty` |
| **Duplicate Coupon Usage** | **Atomic Update** | Conditional update with `UPDATE WHERE used = false` |
| **Duplicate Orders (rapid clicks)** | **Idempotency Key** | Client UUID + Redis cache |
| **Cache Stampede** | **Distributed Lock** | Prevent simultaneous DB queries on cache expiry |
| **Duplicate Batch Execution** | **Distributed Lock** | Multi-instance environment |

### Quick Checklist

- [ ] Are you using atomic UPDATE (`WHERE stock >= qty`) for inventory deduction?
- [ ] Are you using atomic UPDATE (`WHERE used = false`) for coupon usage?
- [ ] Are you using idempotency keys to prevent duplicate orders?
- [ ] Are you using distributed locks only when truly necessary?
- [ ] Are you sorting by product ID to prevent deadlocks when ordering multiple products?

### Decision Criterion

```
"Can this be solved with an atomic UPDATE or idempotency key?"
    → If yes, no distributed lock needed!
```

---

The next part covers **Caching Strategies and Redis Usage**.

[Next: Part 2 - Caching Strategy](/en/blog/springboot-practical-guide-2)
