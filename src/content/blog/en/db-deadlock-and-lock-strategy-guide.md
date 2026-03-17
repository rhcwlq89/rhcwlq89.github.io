---
title: "Deadlocks and Lock Strategies by Isolation Level: From Pessimistic Locks to FOR UPDATE's Limits"
description: "Real deadlock cases at each isolation level — Read Committed, Repeatable Read, and Serializable. Covers pessimistic vs optimistic locking, FOR UPDATE mechanics, and why you'll eventually need Redis."
pubDate: "2026-03-17T23:50:00+09:00"
tags: ["Database", "Deadlock", "Lock", "Transaction", "Spring Boot"]
heroImage: "../../../assets/DbDeadlockAndLockStrategyGuide.png"
lang: en
---

## Introduction

In the [previous post](/blog/en/db-isolation-level-guide), we covered isolation levels and concurrency anomalies. This post goes one level deeper — **"When do deadlocks actually occur, and how do we prevent them?"**

"Doesn't raising the isolation level make things safer?" — half right, half wrong. Higher isolation reduces anomalies, but **it also increases lock usage, which actually raises deadlock risk**.

---

## 1. What Is a Deadlock?

Two transactions waiting for each other's locks, **stuck forever**.

```mermaid
sequenceDiagram
    participant TX1 as TX1
    participant DB as Database
    participant TX2 as TX2

    TX1->>DB: UPDATE accounts SET ... WHERE id = 1 (lock id=1)
    TX2->>DB: UPDATE accounts SET ... WHERE id = 2 (lock id=2)
    TX1->>DB: UPDATE accounts SET ... WHERE id = 2
    Note over TX1: Waiting for id=2... ⏳
    TX2->>DB: UPDATE accounts SET ... WHERE id = 1
    Note over TX2: Waiting for id=1... ⏳
    Note over TX1,TX2: 💀 Deadlock! Waiting forever
```

Analogy: two cars facing each other in a narrow alley. Both say "you go first" and neither moves. The DB detects this and **force-rolls back one side** to break the deadlock.

---

## 2. Deadlock Cases by Isolation Level

### 2.1 Deadlocks in Read Committed

Read Committed is relatively loose, yet deadlocks still occur. Why? **Reads don't lock, but writes (UPDATE/DELETE) still acquire row locks.**

#### Case 1: Cross-Update

The most common pattern. Two simultaneous transfers: A→B and B→A:

```mermaid
sequenceDiagram
    participant TX1 as TX1 (A→B transfer)
    participant DB as Database
    participant TX2 as TX2 (B→A transfer)

    TX1->>DB: UPDATE balance WHERE id='A' (lock A)
    TX2->>DB: UPDATE balance WHERE id='B' (lock B)
    TX1->>DB: UPDATE balance WHERE id='B'
    Note over TX1: Waiting for B... ⏳
    TX2->>DB: UPDATE balance WHERE id='A'
    Note over TX2: Waiting for A... ⏳
    Note over TX1,TX2: 💀 Deadlock!
```

#### Case 2: Implicit Locks from FK Constraints

Deadlocks can occur without explicit UPDATEs. Inserting into a table with FKs places **shared locks on the parent table**:

```sql
-- orders table has user_id FK

-- TX1: Insert order for user 1 → shared lock on users(id=1)
INSERT INTO orders (user_id, product_id) VALUES (1, 100);

-- TX2: Update user 1 → needs exclusive lock on users(id=1)
UPDATE users SET updated_at = now() WHERE id = 1;
-- → Conflicts with TX1's shared lock!
```

> Tables with many FKs and frequent concurrent INSERTs and UPDATEs can produce unexpected deadlocks.

### 2.2 Deadlocks in Repeatable Read

Repeatable Read holds **more locks for longer** than Read Committed. In MySQL InnoDB, **Gap Locks** create additional deadlock risk.

#### What Are Gap Locks?

Gap Locks lock the **gaps between index records**. InnoDB uses them in Repeatable Read to prevent Phantom Reads.

```sql
-- products table: id = 1, 5, 10

-- TX1: Query ids 3-7 (FOR UPDATE)
SELECT * FROM products WHERE id BETWEEN 3 AND 7 FOR UPDATE;
-- → Locks the gap between 1-5 AND the gap between 5-10!
-- → INSERT of id=3, 4, 6, 7 is blocked
```

```mermaid
graph LR
    subgraph "Index (id)"
        A["id=1"] --- B["gap (2,3,4)"] --- C["id=5"] --- D["gap (6,7,8,9)"] --- E["id=10"]
    end
    style B fill:#ff6b6b,stroke:#333,color:#fff
    style D fill:#ff6b6b,stroke:#333,color:#fff
```

Non-existent rows (id=3, 4, 6, 7) get locked too, meaning **a wider range than expected gets locked, causing deadlocks**.

#### Case: Gap Lock Deadlock

```mermaid
sequenceDiagram
    participant TX1 as TX1
    participant DB as Database
    participant TX2 as TX2

    Note over DB: products: id = 1, 5, 10
    TX1->>DB: SELECT * FROM products WHERE id = 3 FOR UPDATE
    Note over TX1: Gap lock on 1~5
    TX2->>DB: SELECT * FROM products WHERE id = 7 FOR UPDATE
    Note over TX2: Gap lock on 5~10
    TX1->>DB: INSERT INTO products (id) VALUES (8)
    Note over TX1: Waiting for 5~10 gap... ⏳
    TX2->>DB: INSERT INTO products (id) VALUES (2)
    Note over TX2: Waiting for 1~5 gap... ⏳
    Note over TX1,TX2: 💀 Deadlock!
```

Two transactions lock different gaps, then try to INSERT into each other's gaps. **This deadlock doesn't occur in Read Committed because Gap Locks don't exist there.**

### 2.3 Deadlocks in Serializable

Serializable is the strictest and has the **most frequent deadlocks**.

#### MySQL: Every SELECT Becomes FOR SHARE

```sql
-- In Serializable, this query:
SELECT balance FROM accounts WHERE id = 1;

-- Internally becomes:
SELECT balance FROM accounts WHERE id = 1 FOR SHARE;
```

Even reads acquire **shared locks**, so upgrading to exclusive locks for UPDATE frequently causes conflicts:

```mermaid
sequenceDiagram
    participant TX1 as TX1
    participant DB as Database
    participant TX2 as TX2

    TX1->>DB: SELECT balance WHERE id=1 (shared lock)
    TX2->>DB: SELECT balance WHERE id=1 (shared lock)
    TX1->>DB: UPDATE balance WHERE id=1
    Note over TX1: Needs exclusive lock → waiting for TX2... ⏳
    TX2->>DB: UPDATE balance WHERE id=1
    Note over TX2: Needs exclusive lock → waiting for TX1... ⏳
    Note over TX1,TX2: 💀 Deadlock!
```

A simple read-then-write pattern causes deadlocks. **Concurrency drops dramatically in Serializable.**

#### PostgreSQL: SSI Is Different

PostgreSQL implements Serializable as SSI (Serializable Snapshot Isolation). It's conflict-detection based, not lock-based, so deadlocks are rare. Instead, you get **serialization failures**:

```
ERROR: could not serialize access due to concurrent update
```

Not a deadlock, but one transaction gets rolled back — retry logic is essential.

---

## 3. Pessimistic vs Optimistic Locking

Two philosophies for handling concurrency.

### 3.1 Pessimistic Lock

**"Assume conflicts will happen. Lock first."**

```sql
BEGIN;
SELECT * FROM products WHERE id = 1 FOR UPDATE;  -- Lock first!
-- Other transactions can't read or modify this row
UPDATE products SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

```java
// Spring Boot
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Product findByIdForUpdate(@Param("id") Long id);
```

| Pros | Cons |
|------|------|
| Guaranteed data consistency | Low concurrency (lock waiting) |
| Simple implementation | Deadlock risk |
| | Longer connection hold time |

**Best for**: Frequent conflicts (stock deduction, seat selection)

### 3.2 Optimistic Lock

**"Assume conflicts are rare. Proceed, then detect."**

Add a `version` column and check if it changed during UPDATE:

```sql
-- 1. Read (no lock)
SELECT id, stock, version FROM products WHERE id = 1;
-- → stock=10, version=3

-- 2. Update attempt (check version)
UPDATE products
SET stock = 9, version = 4
WHERE id = 1 AND version = 3;
-- → 0 rows affected? Someone else modified it → retry
```

```java
// Spring Boot - @Version annotation
@Entity
public class Product {
    @Id
    private Long id;
    private int stock;

    @Version
    private Long version;  // JPA manages this automatically
}
```

```java
// Retry logic
@Retryable(value = OptimisticLockingFailureException.class, maxAttempts = 3)
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findById(productId).orElseThrow();
    if (product.getStock() <= 0) throw new SoldOutException();
    product.decreaseStock();
    // On COMMIT, version mismatch → OptimisticLockingFailureException → retry
}
```

| Pros | Cons |
|------|------|
| No locks, high concurrency | Retry cost on conflicts |
| No deadlocks | Retry explosion if conflicts are frequent |
| Short connection hold | Retry logic required |

**Best for**: Rare conflicts (post editing, settings updates)

### 3.3 Which One to Use?

```mermaid
graph TD
    A["Are concurrent modifications frequent?"] -->|Frequent| B["Pessimistic lock FOR UPDATE"]
    A -->|Rare| C["Optimistic lock @Version"]
    B --> D["Is traffic high?"]
    D -->|High| E["Consider Redis / queues → Phase 2"]
    D -->|Normal| F["FOR UPDATE is enough"]
```

| Situation | Recommendation |
|-----------|---------------|
| Stock deduction, seat selection | Pessimistic lock (`FOR UPDATE`) |
| Post editing, profile updates | Optimistic lock (`@Version`) |
| Thousands of concurrent requests/sec | Redis (next series) |

---

## 4. Deadlock Prevention Strategies

### 4.1 Consistent Lock Ordering

The root cause of deadlocks is **locking in different orders**. Always lock in the same order and cross-waiting never happens.

```java
// Bad: order not guaranteed
public void transfer(Long fromId, Long toId, int amount) {
    Account from = accountRepo.findByIdForUpdate(fromId);  // lock fromId
    Account to = accountRepo.findByIdForUpdate(toId);      // lock toId
}

// Good: always sort by ID ascending
public void transfer(Long fromId, Long toId, int amount) {
    Long firstId = Math.min(fromId, toId);
    Long secondId = Math.max(fromId, toId);

    Account first = accountRepo.findByIdForUpdate(firstId);   // smaller ID first
    Account second = accountRepo.findByIdForUpdate(secondId);  // larger ID second

    // Then determine from/to and execute transfer logic
}
```

### 4.2 Lock Timeouts

Don't wait forever. Set a timeout.

```sql
-- MySQL: give up after 5 seconds
SET innodb_lock_wait_timeout = 5;

-- PostgreSQL: give up after 5 seconds
SET lock_timeout = '5s';
```

```java
// Spring Boot JPA hint
@QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT p FROM Product p WHERE p.id = :id")
Product findByIdForUpdate(@Param("id") Long id);
```

### 4.3 Retry Logic

Deadlocks can't be completely prevented. When the DB detects one and rolls back a transaction, **the rolled-back side retries**.

```java
@Retryable(
    value = {DeadlockLoserDataAccessException.class, CannotAcquireLockException.class},
    maxAttempts = 3,
    backoff = @Backoff(delay = 100, multiplier = 2)  // 100ms, 200ms, 400ms
)
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findByIdForUpdate(productId);
    if (product.getStock() <= 0) throw new SoldOutException();
    product.decreaseStock();
}
```

> **Note**: `@Retryable` must be on the outer layer, outside `@Transactional`. The transaction must be rolled back first, then retried with a new transaction. Same-class calls may not work due to proxy issues.

### 4.4 Keep Transactions Short

Longer lock hold time = higher deadlock probability. Never put **external API calls, file I/O, or heavy computation** inside a transaction.

```java
// Bad: external API call inside transaction
@Transactional
public void processOrder(Long productId) {
    Product p = productRepo.findByIdForUpdate(productId);  // lock acquired
    p.decreaseStock();
    externalPaymentApi.charge(order);  // 💀 3 seconds = lock held for 3 seconds
    emailService.sendConfirmation(order);  // 💀 more delay
}

// Good: transaction only for DB work
@Transactional
public void deductStock(Long productId) {
    Product p = productRepo.findByIdForUpdate(productId);
    p.decreaseStock();
}

// External calls outside transaction
public void processOrder(Long productId) {
    deductStock(productId);  // short transaction
    externalPaymentApi.charge(order);  // lock already released
    emailService.sendConfirmation(order);
}
```

---

## 5. Is REPEATABLE READ Enough for Stock Deduction?

Let's definitively answer this question from the previous post.

### Answer: No (in MySQL)

Repeatable Read guarantees **"the values you read won't change"**, NOT **"nobody else can modify at the same time."**

```mermaid
sequenceDiagram
    participant TX1 as TX1 (Order A)
    participant DB as Database (stock: 1)
    participant TX2 as TX2 (Order B)

    TX1->>DB: SELECT stock WHERE id = 1
    DB-->>TX1: 1 (snapshot)
    TX2->>DB: SELECT stock WHERE id = 1
    DB-->>TX2: 1 (snapshot)
    TX1->>DB: UPDATE stock = 0 (1-1)
    TX1->>DB: COMMIT
    TX2->>DB: UPDATE stock = -1 (thinks stock is still 1)
    TX2->>DB: COMMIT
    Note over DB: Stock is negative! 💀 Lost Update
```

### Adding FOR UPDATE Fixes It

```mermaid
sequenceDiagram
    participant TX1 as TX1 (Order A)
    participant DB as Database (stock: 1)
    participant TX2 as TX2 (Order B)

    TX1->>DB: SELECT stock WHERE id = 1 FOR UPDATE
    Note over DB: Row lock → TX1 exclusive
    DB-->>TX1: 1
    TX2->>DB: SELECT stock WHERE id = 1 FOR UPDATE
    Note over TX2: Waiting for lock... ⏳
    TX1->>DB: UPDATE stock = 0
    TX1->>DB: COMMIT (lock released)
    DB-->>TX2: 0 (latest value!)
    Note over TX2: stock = 0 → sold out
    TX2->>DB: ROLLBACK
```

### The Isolation Level Doesn't Matter

With `FOR UPDATE`, **Read Committed and Repeatable Read behave identically.** The lock is what matters, not the isolation level.

**Practical recommendation: `Isolation.DEFAULT` + `FOR UPDATE`** — keep the DB default, control concurrency with explicit locks.

---

## 6. The Limits of FOR UPDATE

FOR UPDATE solves stock deduction, but **three bottlenecks emerge at high traffic**.

### 6.1 Request Serialization

```
100 concurrent users → FOR UPDATE → 1 processes, 99 wait → one at a time

TPS example:
  50ms per transaction × 100 users = up to 5s wait
  200ms per transaction × 1000 users = up to 200s wait 💀
```

### 6.2 Deadlock Risk

If a single order deducts stock + uses a coupon + deducts points, multiple rows get locked, increasing deadlock probability.

### 6.3 Connection Pool Exhaustion

Transactions waiting for locks **hold DB connections**. HikariCP default pool size is 10 — if all 10 are waiting for locks, new requests can't even get a connection.

```
[Request 101] → Connection pool empty → HikariCP timeout → Error!
```

### That's Why the Next Step Is Needed

| Limitation | Alternative |
|-----------|------------|
| Serialization bottleneck | Redis atomic operations (DECR) — tens of thousands TPS without locks |
| Deadlocks | Redis Lua scripts — single-threaded atomic execution |
| Connection exhaustion | Queue systems — reduce DB access entirely |

**This is the starting point for the next series (Phase 2: First-Come-First-Served System Design).**

---

## Summary

| Key Point | Details |
|-----------|---------|
| **Deadlocks occur at every isolation level** | Write locks exist regardless of isolation level |
| **Higher isolation = higher deadlock risk** | Gap Locks (Repeatable Read), shared locks (Serializable) |
| **Pessimistic vs Optimistic** | Frequent conflicts → pessimistic, rare conflicts → optimistic |
| **4 deadlock prevention principles** | Consistent lock order, timeouts, retries, short transactions |
| **Stock deduction's key is FOR UPDATE** | Isolation level doesn't matter — explicit locks guarantee safety |
| **FOR UPDATE's limits** | Serialization bottleneck, deadlocks, connection exhaustion → need Redis/queues |

The next posts begin **Phase 2: First-Come-First-Served System Design**. We'll go beyond DB locks to implement the system using Redis, message queues, tokens, and more.
