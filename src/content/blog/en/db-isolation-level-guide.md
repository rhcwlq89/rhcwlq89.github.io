---
title: "Transaction Isolation Levels Explained: From Read Uncommitted to Serializable"
description: "A practical guide to the 4 transaction isolation levels with real-world examples. Covers concurrency anomalies, MySQL vs PostgreSQL differences, and how to choose the right level."
pubDate: "2026-03-17T22:30:00+09:00"
tags: ["Database", "Transaction", "Isolation Level", "MySQL", "PostgreSQL"]
heroImage: "../../../assets/DbIsolationLevelGuide.png"
lang: en
---

## Introduction

"What are transaction isolation levels?" — it comes up in interviews, and in production, it's a common root cause of concurrency bugs. But official docs make it feel abstract with heavy terminology.

This guide explains all 4 isolation levels through a single scenario: **bank account transfers**. You'll see exactly which problems occur at which level, and why.

---

## 1. What Is a Transaction?

Before isolation levels, let's clarify what a transaction is.

A transaction guarantees **"all or nothing."**

```sql
-- Transfer from account A to B: $1,000
BEGIN;
UPDATE accounts SET balance = balance - 1000 WHERE id = 'A';  -- Deduct from A
UPDATE accounts SET balance = balance + 1000 WHERE id = 'B';  -- Credit to B
COMMIT;
```

If only the first UPDATE succeeds and the second fails? A's money is gone but B never received it. Transactions prevent this — either both succeed, or both are rolled back.

### ACID in One Line Each

| Property | Meaning | Analogy |
|----------|---------|---------|
| **Atomicity** | All succeed or all fail | A package can't half-arrive |
| **Consistency** | Data rules hold before and after | Balance can't go negative |
| **Isolation** | Concurrent transactions don't interfere | Two ATMs withdrawing simultaneously don't corrupt data |
| **Durability** | Committed data persists permanently | Deposit records survive a power outage |

Today we're focusing on **Isolation**: "When multiple transactions run simultaneously, how much should they see of each other?"

---

## 2. Why Do We Need Isolation Levels?

Perfect isolation (= executing transactions one at a time) is possible, but **slow.**

```
User A's transaction completes → User B starts → completes → User C starts → ...
```

With 1,000 concurrent users, 999 are waiting. Not realistic.

So a trade-off emerged: **"Allow some interference in exchange for better performance."** The degree of that trade-off is what **isolation levels** define.

Higher isolation = safer but slower. Lower isolation = faster but weird things can happen.

```
Low ◄──────────────────────────────► High
Fast                                   Slow
Risky                                  Safe

Read Uncommitted → Read Committed → Repeatable Read → Serializable
```

---

## 3. Concurrency Anomalies

To understand isolation levels, you first need to know **"what goes wrong when isolation is insufficient?"** All examples start with **Account A balance: $10,000**.

### 3.1 Dirty Read

**Reading uncommitted data from another transaction.**

```
[t1] TX1: UPDATE accounts SET balance = 0 WHERE id = 'A'
          (A balance: $10,000 → $0, NOT committed yet)

[t2] TX2: SELECT balance FROM accounts WHERE id = 'A'
          → reads $0  💀 Dirty Read!

[t3] TX1: ROLLBACK  (A balance restored to $10,000)

[t4] TX2: Makes decisions based on "$0 balance" — data that never existed
```

Transaction 1 rolled back, but Transaction 2 already read $0. It saw **data that never actually existed**.

Analogy: a teacher is in the middle of correcting a test score (not finalized yet) and someone reads that score.

### 3.2 Non-Repeatable Read

**Reading the same data twice in one transaction and getting different values.**

```
[t1] TX1: SELECT balance WHERE id = 'A'  → $10,000

[t2] TX2: UPDATE balance = $5,000 WHERE id = 'A'
     TX2: COMMIT

[t3] TX1: SELECT balance WHERE id = 'A'  → $5,000  💀 Value changed!
```

Same SELECT, different results. From Transaction 1's perspective: "Someone changed it while I was reading!"

Analogy: you're reading a book, step away to the restroom, and someone rewrites the page while you're gone.

### 3.3 Phantom Read

**Same query condition returns a different number of rows.**

```
[t1] TX1: SELECT count(*) WHERE balance > $5,000  → 3 rows

[t2] TX2: INSERT INTO accounts VALUES ('D', $8,000)
     TX2: COMMIT

[t3] TX1: SELECT count(*) WHERE balance > $5,000  → 4 rows  💀 Phantom row!
```

Existing rows didn't change — a **new row appeared like a phantom**. Hence the name.

Analogy: you count the students in a classroom, turn around, and someone sneaks in and sits down.

### 3.4 Lost Update

**Two transactions modify the same data simultaneously, and one change is lost.**

```
[t1] TX1: SELECT balance WHERE id = 'A'  → $10,000
[t2] TX2: SELECT balance WHERE id = 'A'  → $10,000

[t3] TX1: UPDATE balance = 10000 - 3000 = $7,000
     TX1: COMMIT

[t4] TX2: UPDATE balance = 10000 - 2000 = $8,000  (unaware of TX1!)
     TX2: COMMIT

Result: A balance = $8,000  💀 (should be 10000 - 3000 - 2000 = $5,000)
```

Transaction 1's $3,000 deduction is completely lost. In a first-come-first-served system, this means **orders going through even when stock is zero**.

---

## 4. The Four Isolation Levels

### 4.1 Read Uncommitted (Level 0)

**The loosest isolation.** Can read uncommitted changes from other transactions.

```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
```

| Anomaly | Occurs? |
|---------|---------|
| Dirty Read | Yes |
| Non-Repeatable Read | Yes |
| Phantom Read | Yes |

> In practice, this level is **almost never used.** Only for extreme cases like "I need rough statistics fast." It's not the default in any major database.

### 4.2 Read Committed (Level 1)

**Only committed data is visible.** Prevents Dirty Reads, but the same query can return different values within one transaction.

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

| Anomaly | Occurs? |
|---------|---------|
| Dirty Read | No |
| Non-Repeatable Read | Yes |
| Phantom Read | Yes |

> **Default for PostgreSQL and Oracle.** Sufficient for most web services.

#### How It Works: Fresh Snapshot Per Query

Read Committed takes a **fresh snapshot of committed data** for each SELECT.

```
t1: Transaction starts
t2: SELECT → reads data committed as of t2
t3: (another transaction commits)
t4: SELECT → reads data committed as of t4 (t3's changes are visible!)
```

That's why results can differ within the same transaction (Non-Repeatable Read).

### 4.3 Repeatable Read (Level 2)

**Maintains a snapshot from when the transaction started.** The same SELECT always returns the same result throughout the transaction.

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

| Anomaly | Occurs? |
|---------|---------|
| Dirty Read | No |
| Non-Repeatable Read | No |
| Phantom Read | Depends on DB |

> **Default for MySQL (InnoDB).** InnoDB uses MVCC + Next-Key Locks to prevent most Phantom Reads too.

#### How It Works: Snapshot Fixed at Transaction Start

```
t1: Transaction starts → snapshot fixed at this point!
t2: SELECT → sees t1's data
t3: (another transaction commits)
t4: SELECT → still sees t1's data (t3's changes are invisible!)
```

The key difference from Read Committed: **when the snapshot is taken**.

```
Read Committed:   new snapshot per SELECT
Repeatable Read:  snapshot fixed at transaction start, held until end
```

#### MySQL vs PostgreSQL Repeatable Read

This is important. Same name, different behavior:

| | MySQL (InnoDB) | PostgreSQL |
|--|---------------|------------|
| **Phantom Read prevention** | Yes (Next-Key Lock) | Yes (snapshot-based) |
| **Lost Update prevention** | No (explicit lock needed) | Yes (first updater wins, others error) |
| **Implementation** | MVCC + Gap Lock | MVCC (snapshot-based) |

In MySQL, even with Repeatable Read, you need `SELECT ... FOR UPDATE` to prevent Lost Updates.

### 4.4 Serializable (Level 3)

**The strictest isolation.** Transactions behave as if executed one at a time, sequentially.

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

| Anomaly | Occurs? |
|---------|---------|
| Dirty Read | No |
| Non-Repeatable Read | No |
| Phantom Read | No |

All anomalies are blocked. But the cost is high:

```
Performance: can be 5-10x slower than Read Committed
Concurrency: conflicting transactions get rolled back
```

> Used only in systems where **correctness is critical**: financial settlements, seat assignments. Overkill for typical web services.

#### MySQL vs PostgreSQL Serializable

| | MySQL (InnoDB) | PostgreSQL |
|--|---------------|------------|
| **Implementation** | Converts all SELECTs to `SELECT ... FOR SHARE` (lock-based) | SSI (Serializable Snapshot Isolation, optimistic) |
| **Behavior** | Heavy locking, higher deadlock risk | Detects conflicts and rolls back, fewer locks |

---

## 5. Summary Comparison

| Isolation Level | Dirty Read | Non-Repeatable Read | Phantom Read | Performance |
|----------------|-----------|-------------------|-------------|-------------|
| **Read Uncommitted** | Yes | Yes | Yes | Fastest |
| **Read Committed** | No | Yes | Yes | Fast |
| **Repeatable Read** | No | No | Depends | Moderate |
| **Serializable** | No | No | No | Slow |

### Why Do Defaults Differ?

| Database | Default Level | Reason |
|----------|-------------|--------|
| **MySQL (InnoDB)** | Repeatable Read | Consistency guarantees for binary log replication |
| **PostgreSQL** | Read Committed | MVCC is strong enough for most cases |
| **Oracle** | Read Committed | Performance priority in high-concurrency environments |
| **SQL Server** | Read Committed | Same reasoning as Oracle |

---

## 6. How to Choose in Practice

### Most web services → Read Committed

Forums, e-commerce, general API servers. Sufficient for the majority of cases. If you're using PostgreSQL, it's the default — no config needed.

### Business logic requiring correctness → Repeatable Read + explicit locks

Stock deduction, point deduction, seat selection. Don't just raise the isolation level — use `SELECT ... FOR UPDATE` to explicitly lock the rows you need.

```sql
BEGIN;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;  -- Acquire lock
-- Check stock > 0
UPDATE products SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

### Financial settlements, audit logs → Serializable

Systems where errors mean lost money or legal issues. Accept the performance cost for the highest isolation.

### Rough statistics, dashboards → Read Uncommitted (extremely rare)

"Roughly how many orders right now?" — queries that don't need precision. But Read Committed is fast enough that this is almost never used in practice.

---

## 7. Setting Isolation Levels in Spring Boot

```java
// Set isolation level per method
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void deductStock(Long productId) {
    Product product = productRepository.findByIdForUpdate(productId);  // FOR UPDATE
    if (product.getStock() <= 0) {
        throw new SoldOutException();
    }
    product.decreaseStock();
}
```

```java
// FOR UPDATE in Repository
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Product findByIdForUpdate(@Param("id") Long id);
}
```

> **Note**: `@Transactional(isolation = ...)` only applies to that transaction. It doesn't change the database's global default.

---

## Summary

| Key Point | Details |
|-----------|---------|
| **What are isolation levels?** | Settings that control how much concurrent transactions can see each other's data |
| **Higher = safer, lower = faster** | It's a trade-off. Always choosing the highest isn't the answer |
| **Production defaults** | PostgreSQL/Oracle → Read Committed, MySQL → Repeatable Read |
| **For first-come-first-served?** | Read Committed + explicit locks (`FOR UPDATE`) is the standard approach |

In the next post, we'll cover **real deadlock scenarios at each isolation level** and how to prevent them.
