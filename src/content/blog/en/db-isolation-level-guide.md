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

| Isolation Level | Speed | Safety | Note |
|----------------|:---:|:---:|--------|
| Read Uncommitted | ⚡⚡⚡⚡ | 🛡️ | Rarely used |
| Read Committed | ⚡⚡⚡ | 🛡️🛡️ | PostgreSQL, Oracle default |
| Repeatable Read | ⚡⚡ | 🛡️🛡️🛡️ | MySQL default |
| Serializable | ⚡ | 🛡️🛡️🛡️🛡️ | Perfect but slow |

---

## 2.1 How Isolation Levels Are Implemented: MVCC

If isolation levels define "how much to isolate," **MVCC (Multi-Version Concurrency Control) answers "how to isolate."**

The core idea of MVCC is simple: **when data is modified, the old version is kept instead of being overwritten.** Readers access the old version without locks, while writers create a new version.

```
[Without MVCC (lock-based)]
TX1: UPDATE → row locked 🔒
TX2: SELECT → waiting for lock ⏳ (until TX1 finishes)
→ Reads and writes block each other

[With MVCC]
TX1: UPDATE → creates new version (v2), keeps old version (v1)
TX2: SELECT → reads v1 (no lock, executes immediately)
→ Reads and writes don't block each other
```

MySQL (InnoDB), PostgreSQL, and Oracle all use MVCC. This enables the principle: **"reads don't block writes, and writes don't block reads."**

The isolation level determines **which version gets read**:

| Isolation Level | MVCC Behavior |
|----------------|--------------|
| Read Uncommitted | Always reads the latest version (even uncommitted) |
| Read Committed | Latest committed version **at each query's start** |
| Repeatable Read | Committed version **at the transaction's start** (fixed snapshot) |
| Serializable | Varies by DB (MySQL: adds locks, PostgreSQL: SSI) |

> Throughout this series, phrases like "reads from a snapshot" and "previous version in the undo log" all refer to MVCC in action.

---

## 3. Concurrency Anomalies

To understand isolation levels, you first need to know **"what goes wrong when isolation is insufficient?"** All examples start with **Account A balance: $10,000**.

### 3.1 Dirty Read

**Reading uncommitted data from another transaction.**

| Step | TX1 (Transfer) | TX2 (Query) | A Balance |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (not committed) | | $10,000→$0 |
| 2 | | `SELECT balance` → **$0** 💀 | $0 |
| 3 | `ROLLBACK` | | $10,000 |
| 4 | | Makes wrong decision based on $0 | $10,000 |

Transaction 1 rolled back, but Transaction 2 already read $0. It saw **data that never actually existed**.

> **Analogy**: A teacher is in the middle of correcting a test score (not finalized yet) and someone reads that score.

### 3.2 Non-Repeatable Read

**Reading the same data twice in one transaction and getting different values.**

| Step | TX1 (Query) | TX2 (Update) | A Balance |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT balance` → **$10,000** | | $10,000 |
| 2 | | `UPDATE balance = $5,000` | $10,000→$5,000 |
| 3 | | `COMMIT` | $5,000 |
| 4 | `SELECT balance` → **$5,000** 💀 | | $5,000 |

Same SELECT, different results. From Transaction 1's perspective: "Someone changed it while I was reading!"

> **Analogy**: You're reading a book, step away to the restroom, and someone rewrites the page while you're gone.

### 3.3 Phantom Read

**Same query condition returns a different result set.** INSERT, UPDATE, and DELETE can all cause it.

#### Phantom Read from INSERT

| Step | TX1 (Query) | TX2 (Insert) | Rows matching `balance > $5,000` |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT count(*)` → **3 rows** | | 3 |
| 2 | | `INSERT ('D', $8,000)` | 3 |
| 3 | | `COMMIT` | 4 |
| 4 | `SELECT count(*)` → **4 rows** 💀 | | 4 |

UPDATE and DELETE cause the same problem — the result set changes between reads:

| Cause | What TX2 Does | TX1's count(*) Before → After |
|-------|-------------|:------:|
| **INSERT** | Adds account D with $8,000 | 3 → **4** (new row appeared) |
| **UPDATE** | Changes D's balance from $3,000 to $8,000 | 3 → **4** (row now matches condition) |
| **DELETE** | Deletes account C (balance $7,000) | 3 → **2** (row disappeared) |

> **Analogy**: You count students wearing glasses in a classroom — then a new student walks in (INSERT), a student puts on glasses (UPDATE), or a student wearing glasses leaves (DELETE).

### 3.4 Lost Update

**Two transactions modify the same data simultaneously, and one change is lost.**

| Step | TX1 (Withdraw $3,000) | TX2 (Withdraw $2,000) | A Balance |
|:---:|-----------|-----------|:------:|
| 1 | `SELECT balance` → **$10,000** | | $10,000 |
| 2 | | `SELECT balance` → **$10,000** | $10,000 |
| 3 | `UPDATE balance = $7,000` (10000-3000) | | $7,000 |
| 4 | `COMMIT` | | $7,000 |
| 5 | | `UPDATE balance = $8,000` (10000-2000) 💀 | $8,000 |
| 6 | | `COMMIT` | $8,000 |

Final balance: **$8,000** — should be **$5,000** (10000-3000-2000). Transaction 1's $3,000 deduction is completely lost. In a first-come-first-served system, this means **orders going through even when stock is zero**.

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
| **SQL Server** | Read Committed | Same reasoning as Oracle. RCSI option changes behavior |

### Read Committed Snapshot Isolation (RCSI)

Not part of the SQL standard, but commonly encountered in practice — **Read Committed Snapshot Isolation (RCSI)**. In short: regular Read Committed uses locks (readers wait for writers), while RCSI uses snapshots (readers never wait). PostgreSQL, Oracle, and MySQL already behave like RCSI by default — **only SQL Server needs it explicitly enabled**.

<details>
<summary>RCSI Deep Dive (click to expand)</summary>

#### Regular Read Committed (Lock-Based)

| Step | TX1 (Write) | TX2 (Read) | A Balance |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (lock acquired) | | $10,000→$0 |
| 2 | | `SELECT balance` → waiting for lock... ⏳ | $0 |
| 3 | `COMMIT` (lock released) | | $0 |
| 4 | | `SELECT` completes → **$0** | $0 |

#### RCSI (Snapshot-Based)

| Step | TX1 (Write) | TX2 (Read) | A Balance |
|:---:|-----------|-----------|:------:|
| 1 | `UPDATE balance = 0` (lock acquired) | | $10,000→$0 |
| 2 | | `SELECT balance` → **$10,000** (reads snapshot, no waiting!) | $0 |
| 3 | `COMMIT` | | $0 |

#### The Key Difference

| | Regular Read Committed | RCSI |
|--|----------------------|------|
| **Read locks** | Shared locks (conflicts with write locks) | No locks (snapshot read) |
| **Reads vs Writes** | Block each other | Don't block each other |
| **Concurrency** | Lower | Higher |
| **Overhead** | Lock management | Version store in tempdb |

#### Database Support

| Database | RCSI Support | How to Enable |
|----------|-------------|---------------|
| **SQL Server** | Yes (DB option) | `ALTER DATABASE mydb SET READ_COMMITTED_SNAPSHOT ON` |
| **PostgreSQL** | Default behavior | MVCC always reads snapshots (no config needed) |
| **Oracle** | Default behavior | Undo segments always provide snapshots |
| **MySQL (InnoDB)** | Default behavior | MVCC provides snapshot reads in Read Committed |

> **Important**: PostgreSQL, Oracle, and MySQL already behave like RCSI in Read Committed (reads don't acquire locks). **Only SQL Server uses lock-based reads by default**, so RCSI must be explicitly enabled. If you're working with SQL Server, strongly consider enabling RCSI.

</details>

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

### 7.1 How It Works

```java
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void deductStock(Long productId) { ... }
```

When this is set, Spring internally executes the following when starting the transaction:

```
1. Enter @Transactional
2. Acquire Connection from DataSource
3. connection.setTransactionIsolation(TRANSACTION_REPEATABLE_READ)
   → Executes SET TRANSACTION ISOLATION LEVEL REPEATABLE READ on the DB
4. BEGIN
5. Execute business logic
6. COMMIT or ROLLBACK
7. Return Connection
```

This applies **only to that transaction** — it doesn't change the database's global default.

### 7.2 Isolation Level Support by Database

Not all databases support all 4 levels. If you set an unsupported level in Spring Boot, you'll get a runtime error.

| Isolation Level | MySQL | MariaDB | PostgreSQL | Oracle | SQL Server |
|----------------|:---:|:---:|:---:|:---:|:---:|
| **Read Uncommitted** | Yes | Yes | △ | No | Yes |
| **Read Committed** | Yes | Yes | Yes (**default**) | Yes (**default**) | Yes (**default**) |
| **Repeatable Read** | Yes (**default**) | Yes (**default**) | △ | No | Yes |
| **Serializable** | Yes | Yes | Yes | Yes | Yes |

**△ = Can be set but behaves differently, No = Not supported (error on set)**

### 7.3 Database-Specific Behavior

#### PostgreSQL

```
Read Uncommitted → Set it, but it behaves as Read Committed (Dirty Read never allowed)
Repeatable Read  → Works, but behaves close to Serializable (snapshot + first-updater-wins)
```

PostgreSQL never allows Dirty Reads by design. Think of it as having **3 effective levels**: Read Committed / Repeatable Read / Serializable (SSI).

#### Oracle

```
Read Uncommitted  → Not supported (error)
Repeatable Read   → Not supported (error)
```

**Only Read Committed and Serializable are supported.** Setting `Isolation.REPEATABLE_READ` in Spring Boot causes a runtime error.

```java
// This ERRORS on Oracle! (ORA-02179)
@Transactional(isolation = Isolation.REPEATABLE_READ)

// For Repeatable Read behavior on Oracle → use explicit locks
@Transactional
public void doSomething() {
    repository.findByIdForUpdate(id);  // SELECT ... FOR UPDATE
}
```

#### MySQL (InnoDB)

All 4 levels supported. Default is Repeatable Read. MVCC + Next-Key Lock prevents most Phantom Reads. However, **Lost Update is NOT prevented** → `FOR UPDATE` is needed.

#### MariaDB (InnoDB)

Behaves nearly identically to MySQL. All 4 levels supported, default Repeatable Read. Some internal implementation differences after MariaDB 10.5+, but isolation level behavior is the same.

#### SQL Server

All 4 levels supported + **Snapshot Isolation** as a 5th level. Default Read Committed is lock-based, so enabling RCSI is recommended.

```sql
-- SQL Server only: enable Snapshot Isolation
ALTER DATABASE mydb SET ALLOW_SNAPSHOT_ISOLATION ON;
SET TRANSACTION ISOLATION LEVEL SNAPSHOT;
```

### 7.4 Do You Actually Change Isolation Levels in Practice?

**Almost never.** Concurrency issues like stock deduction and point deduction are solved with **explicit locks (`FOR UPDATE`), not isolation level changes.** This is the standard pattern.

```java
// The most common code in production. No isolation setting at all.
@Transactional
public void deductStock(Long productId) {
    Product product = productRepository.findByIdForUpdate(productId);  // FOR UPDATE
    if (product.getStock() <= 0) {
        throw new SoldOutException();
    }
    product.decreaseStock();
}
```

```java
// FOR UPDATE in Repository (pessimistic lock)
public interface ProductRepository extends JpaRepository<Product, Long> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT p FROM Product p WHERE p.id = :id")
    Product findByIdForUpdate(@Param("id") Long id);
}
```

Why don't you need to change the isolation level? Because once `FOR UPDATE` locks the row, **the result is identical regardless of isolation level**:

- Read Committed + `FOR UPDATE` → row locked, other TXs wait, reads latest value
- Repeatable Read + `FOR UPDATE` → row locked, other TXs wait, reads latest value
- The result is **identical**

Isolation levels only affect **regular SELECTs without locks**. The moment you use `FOR UPDATE`, the isolation level difference disappears.

> So when would you use `@Transactional(isolation = ...)`? Only in **extreme cases like financial settlements where even every SELECT needs strict control.** In typical web services, you'll almost never need it.

### 7.5 FOR UPDATE Locks and Regular SELECTs

When a row is locked with `FOR UPDATE`, **what happens to regular SELECTs from other transactions?**

For example, TX1 locks product #1 with `FOR UPDATE`, and TX2 runs `COUNT(*)`:

```sql
-- TX1
SELECT * FROM products WHERE id = 1 FOR UPDATE;  -- row locked 🔒

-- TX2 (simultaneously)
SELECT COUNT(*) FROM products WHERE status = 'ON_SALE';  -- includes id=1
```

**Result: TX2 executes immediately with no waiting.**

InnoDB uses MVCC (Multi-Version Concurrency Control), so regular SELECTs **read from a snapshot (previous version in the undo log).** They don't conflict with FOR UPDATE locks.

But what if you add `FOR UPDATE` to the COUNT?

```sql
-- TX2
SELECT COUNT(*) FROM products WHERE status = 'ON_SALE' FOR UPDATE;
```

Now it tries to place an **exclusive lock on every matching row.** If any of those rows are locked by TX1, it **waits until that lock is released.**

| SELECT Type | When it hits a FOR UPDATE locked row | Reason |
|------------|--------------------------------------|--------|
| `SELECT COUNT(*)` | No wait, executes immediately | MVCC snapshot read |
| `SELECT COUNT(*) FOR UPDATE` | Waits until lock is released | Attempts exclusive lock on all matching rows |

> In practice, COUNT is almost always a regular SELECT, so it's unaffected by FOR UPDATE locks. During an FCFS event, you don't need to worry about a "check remaining stock" API slowing down.

### 7.6 Isolation Level Syntax (Reference)

Rarely needed, but good to know:

```java
// Set isolation level per method (extremely rare cases only)
@Transactional(isolation = Isolation.SERIALIZABLE)
public void settlePayments() { ... }

// Isolation.DEFAULT = use DB's default
// MySQL: Repeatable Read, PostgreSQL/Oracle/SQL Server: Read Committed
@Transactional(isolation = Isolation.DEFAULT)  // same as plain @Transactional

// Nested transactions: inner isolation is IGNORED
@Transactional(isolation = Isolation.SERIALIZABLE)
public void outer() {
    inner();  // inner's setting is ignored, outer's SERIALIZABLE applies
}
```

### 7.7 Practical Summary

| Situation | Code | Change Isolation? |
|-----------|------|:---:|
| General CRUD | `@Transactional` | No (DB default) |
| Stock/point deduction | `@Transactional` + `FOR UPDATE` | No (lock is the key) |
| Post editing (rare conflicts) | `@Transactional` + `@Version` (optimistic lock) | No |
| Financial settlements (very rare) | `@Transactional(isolation = Isolation.SERIALIZABLE)` | Yes |

**Key takeaway: 99% of the time, don't touch isolation levels. Use explicit locks when needed.**

---

## Summary

| Key Point | Details |
|-----------|---------|
| **What are isolation levels?** | Settings that control how much concurrent transactions can see each other's data |
| **Higher = safer, lower = faster** | It's a trade-off. Always choosing the highest isn't the answer |
| **Production defaults** | PostgreSQL/Oracle → Read Committed, MySQL → Repeatable Read |
| **For first-come-first-served?** | Read Committed + explicit locks (`FOR UPDATE`) is the standard approach |

In the next post, we'll cover **real deadlock scenarios at each isolation level** and how to prevent them.
